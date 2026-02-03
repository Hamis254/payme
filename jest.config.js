/** @type {import('jest').Config} */
export default {
  testEnvironment: 'node',
  moduleNameMapper: {
    '^#config/(.*)$': '<rootDir>/src/config/$1',
    '^#controllers/(.*)$': '<rootDir>/src/controllers/$1',
    '^#middleware/(.*)$': '<rootDir>/src/middleware/$1',
    '^#utils/(.*)$': '<rootDir>/src/utils/$1',
    '^#models/(.*)$': '<rootDir>/src/models/$1',
    '^#services/(.*)$': '<rootDir>/src/services/$1',
    '^#validations/(.*)$': '<rootDir>/src/validations/$1',
    '^#routes/(.*)$': '<rootDir>/src/routes/$1',
  },
  transform: {
    '^.+\\.js$': ['babel-jest', { presets: [['@babel/preset-env', { targets: { node: 'current' } }]] }],
  },
  moduleFileExtensions: ['js', 'json'],
  testMatch: ['**/tests/**/*.test.js'],
  collectCoverageFrom: [
    'src/**/*.js',
    '!src/**/*.validation.js',
    '!src/config/*.js',
    '!src/index.js',
    '!src/server.js',
    '!src/app.js',
  ],
  coverageDirectory: 'coverage',
  verbose: true,
  testTimeout: 30000,
  setupFilesAfterEnv: ['./tests/setup.js'],
  testPathIgnorePatterns: ['/node_modules/'],
  modulePathIgnorePatterns: ['/node_modules/'],
};
