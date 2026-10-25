param location string
param token string
param tags object
param googleClientId string
param zones string
param admins string

resource logs 'Microsoft.OperationalInsights/workspaces@2022-10-01' = {
  name: 'log-${token}'
  location: location
  tags: tags
  properties: { sku: { name: 'PerGB2018' }, retentionInDays: 30 }
}

resource acr 'Microsoft.ContainerRegistry/registries@2023-07-01' = {
  name: 'cr${token}'
  location: location
  tags: tags
  sku: { name: 'Basic' }
  properties: { adminUserEnabled: false }
}

resource identity 'Microsoft.ManagedIdentity/userAssignedIdentities@2023-01-31' = {
  name: 'id-${token}'
  location: location
  tags: tags
}

// AcrPull for the app identity
resource acrPull 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(acr.id, identity.id, 'acrpull')
  scope: acr
  properties: {
    principalId: identity.properties.principalId
    principalType: 'ServicePrincipal'
    roleDefinitionId: subscriptionResourceId('Microsoft.Authorization/roleDefinitions', '7f951dda-4ed3-4680-a7ca-43fe172d538d')
  }
}

// External persistent storage (Azure Files) holding the JSON data files
resource storage 'Microsoft.Storage/storageAccounts@2023-01-01' = {
  name: 'st${token}'
  location: location
  tags: tags
  sku: { name: 'Standard_LRS' }
  kind: 'StorageV2'
  properties: { minimumTlsVersion: 'TLS1_2', allowBlobPublicAccess: false, supportsHttpsTrafficOnly: true }
}

resource share 'Microsoft.Storage/storageAccounts/fileServices/shares@2023-01-01' = {
  name: '${storage.name}/default/climbdata'
  properties: { shareQuota: 5 }
}

resource env 'Microsoft.App/managedEnvironments@2024-03-01' = {
  name: 'cae-${token}'
  location: location
  tags: tags
  properties: {
    appLogsConfiguration: {
      destination: 'log-analytics'
      logAnalyticsConfiguration: { customerId: logs.properties.customerId, sharedKey: logs.listKeys().primarySharedKey }
    }
  }
}

resource envStorage 'Microsoft.App/managedEnvironments/storages@2024-03-01' = {
  parent: env
  name: 'climbdata'
  properties: {
    azureFile: {
      accountName: storage.name
      accountKey: storage.listKeys().keys[0].value
      shareName: 'climbdata'
      accessMode: 'ReadWrite'
    }
  }
  dependsOn: [share]
}

resource web 'Microsoft.App/containerApps@2024-03-01' = {
  name: 'ca-web-${token}'
  location: location
  tags: union(tags, { 'azd-service-name': 'web' })
  identity: { type: 'UserAssigned', userAssignedIdentities: { '${identity.id}': {} } }
  properties: {
    managedEnvironmentId: env.id
    configuration: {
      activeRevisionsMode: 'Single'
      ingress: { external: true, targetPort: 3000, transport: 'auto', allowInsecure: false }
      registries: [{ server: acr.properties.loginServer, identity: identity.id }]
      secrets: [{ name: 'session-secret', value: uniqueString(storage.id, 'session') }]
    }
    template: {
      containers: [
        {
          name: 'web'
          image: 'mcr.microsoft.com/azuredocs/containerapps-helloworld:latest'
          resources: { cpu: json('0.5'), memory: '1Gi' }
          env: [
            { name: 'DATA_DIR', value: '/data' }
            { name: 'GOOGLE_CLIENT_ID', value: googleClientId }
            { name: 'ZONES', value: empty(zones) ? 'none' : zones }
            { name: 'ADMINS', value: admins }
            { name: 'SESSION_SECRET', secretRef: 'session-secret' }
          ]
          volumeMounts: [{ volumeName: 'data', mountPath: '/data' }]
        }
      ]
      // Single replica: state is a JSON file, so there must be exactly one writer.
      scale: { minReplicas: 1, maxReplicas: 1 }
      volumes: [{ name: 'data', storageType: 'AzureFile', storageName: envStorage.name }]
    }
  }
  dependsOn: [acrPull]
}

output registryEndpoint string = acr.properties.loginServer
output url string = 'https://${web.properties.configuration.ingress.fqdn}'
