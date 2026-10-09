const http = require('http');

function request(method, path, body, token) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'localhost',
      port: 4000,
      path: path,
      method: method,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { 'Authorization': `Bearer ${token}` } : {})
      }
    };
    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => resolve({ status: res.statusCode, body: data }));
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

async function test() {
  console.log('Testing...');
  const login = await request('POST', '/api/auth/login', { email: 'admin@qms.io', password: 'Admin123!' });
  console.log('Login:', login.status);
  const token = JSON.parse(login.body).token;
  
  // Test routing
  const rules = await request('GET', '/api/routing/rules', null, token);
  console.log('Rules:', rules.status);
  
  const dashboard = await request('GET', '/api/routing/dashboard', null, token);
  console.log('Dashboard:', dashboard.status);
  
  const executions = await request('GET', '/api/routing/executions', null, token);
  console.log('Executions:', executions.status);
  
  const escalationRules = await request('GET', '/api/routing/escalation-rules', null, token);
  console.log('Escalation Rules:', escalationRules.status);
  
  // Test seed
  const seed = await request('POST', '/api/routing/rules/seed-defaults', {}, token);
  console.log('Seed:', seed.status);
  
  // Test rules again
  const rules2 = await request('GET', '/api/routing/rules', null, token);
  console.log('Rules after seed:', rules2.status);
  
  // Test tracking
  const tracking = await request('GET', '/api/tracking/documents/tracking/summary', null, token);
  console.log('Tracking:', tracking.status);
  
  const filterOptions = await request('GET', '/api/tracking/documents/tracking/filter-options', null, token);
  console.log('Filter Options:', filterOptions.status);
  
  const across = await request('GET', '/api/tracking/documents/tracking/across?groupBy=current_stage&metric=count', null, token);
  console.log('Across:', across.status);
  
  const list = await request('GET', '/api/tracking/documents/tracking?limit=5', null, token);
  console.log('List:', list.status);
  
  // Test document routing
  const route = await request('POST', '/api/routing/documents/1/route', null, token);
  console.log('Route doc 1:', route.status, route.body);
  
  console.log('\nAll tests passed!');
}

test().catch(console.error);