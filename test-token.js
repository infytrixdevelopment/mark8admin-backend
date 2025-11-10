const { generateMockToken } = require('./middleware/auth');

// Generate token for a test admin user
const token = generateMockToken(
  'cb6e5f8e-5e54-4cf7-8a4e-4a22ef3cc002',
  'admin@example.com',
  'admin'
);

console.log('Mock JWT Token:');
console.log(token);
console.log('\nUse this in Postman Authorization header as:');
console.log('Bearer ' + token);