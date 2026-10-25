// Generates data/seed-routes.json. Replace with the real USAC event 647 routes (see README).
const fs = require('fs');
const cats = [['U11', 6], ['U13', 6], ['U15', 6], ['U17', 6], ['OPEN', 8]];
const colors = ['Red', 'Blue', 'Green', 'Yellow', 'Purple', 'Orange', 'Pink', 'Black'];
let n = 1; const routes = [];
for (const [category, count] of cats) for (let i = 0; i < count; i++, n++)
  routes.push({ id: `r${n}`, number: n, category, name: `${category} ${colors[i % colors.length]}` });
fs.writeFileSync(__dirname + '/../data/seed-routes.json', JSON.stringify(routes, null, 2));
