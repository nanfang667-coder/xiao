// Test register server action directly
require('dotenv').config({ path: '.env' });

// Mock FormData
class MockFormData {
  constructor() {
    this.data = new Map();
  }

  get(key) {
    return this.data.get(key);
  }

  set(key, value) {
    this.data.set(key, value);
  }
}

// Mock redirect function
global.redirect = (url) => {
  console.log('Redirect to:', url);
  throw new Error(`Redirect: ${url}`);
};

// Clear module cache to ensure fresh imports
delete require.cache[require.resolve('./src/app/user-actions.ts')];
delete require.cache[require.resolve('./src/lib/user-auth.ts')];
delete require.cache[require.resolve('./src/lib/prisma.ts')];

// Mock cookies for Next.js
const { cookies } = require('next/headers');
const mockCookies = {
  get: () => ({ value: null }),
  set: () => console.log('Cookie set'),
  delete: () => console.log('Cookie deleted')
};

// Override cookies() function
require('next/headers').cookies = () => mockCookies;

async function testRegister() {
  try {
    // Dynamically import the register function
    const { register } = require('./src/app/user-actions.ts');

    const formData = new MockFormData();
    formData.set('username', 'testuser4');
    formData.set('email', 'test4@example.com');
    formData.set('password', 'password123');

    console.log('Calling register function...');
    await register(formData);
    console.log('Register succeeded (should have redirected)');
  } catch (error) {
    if (error.message.startsWith('Redirect:')) {
      console.log('Redirect caught:', error.message);
      if (error.message.includes('error=')) {
        console.error('Registration failed with error in redirect URL');
      } else {
        console.log('Registration successful (redirect to home)');
      }
    } else {
      console.error('Registration error:', error.message);
      console.error(error.stack);
    }
  }
}

testRegister();