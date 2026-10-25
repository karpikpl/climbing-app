targetScope = 'subscription'

@minLength(1) param environmentName string
@minLength(1) param location string
param googleClientId string = ''
@description('Enabled zones: low,high (empty disables zones)')
param zones string = 'low,high'
param admins string = ''

var token = toLower(uniqueString(subscription().id, environmentName, location))
var tags = { 'azd-env-name': environmentName }

resource rg 'Microsoft.Resources/resourceGroups@2022-09-01' = {
  name: 'rg-${environmentName}'
  location: location
  tags: tags
}

module app 'app.bicep' = {
  name: 'app'
  scope: rg
  params: { location: location, token: token, tags: tags, googleClientId: googleClientId, zones: zones, admins: admins }
}

output AZURE_CONTAINER_REGISTRY_ENDPOINT string = app.outputs.registryEndpoint
output SERVICE_WEB_URI string = app.outputs.url
