// Test authentication functions
require('dotenv').config();
const { registerUser, loginUser } = require('./src/lib/user-auth.ts?');

// Mock the cookies function since we're not in Next.js environment
global.cookies = () => ({
  get: () => ({ value: null }),
  set: () => {},
  delete: () => {}
});

async function test() {
  try {
    console.log('Testing registration...');
    const user = await registerUser({
      username: 'testuser3',
      email: 'test3@example.com',
      password: 'password123'
    });
    console.log('Registration successful:', user.username);

    console.log('Testing login...');
    const loggedInUser = await loginUser({
      usernameOrEmail: 'testuser3',
      password: 'password123'
    });
    console.log('Login successful:', loggedInUser.username);

    console.log('All tests passed!');
  } catch (error) {
    console.error('Test failed:', error.message);
    console.error(error.stack);
  }
}

test();