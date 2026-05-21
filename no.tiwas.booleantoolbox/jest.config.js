module.exports = {
  // Test environment
  testEnvironment: 'node',

  // Test file patterns
  testMatch: [
    '**/__tests__/**/*.js',
    '**/?(*.)+(spec|test).js'
  ],

  // Ignore patterns. Keep these path-separator neutral so they work on Windows too.
  testPathIgnorePatterns: [
    '[/\\\\]node_modules[/\\\\]',
    '[/\\\\]\\.homeybuild[/\\\\]',
    '[/\\\\]coverage[/\\\\]',
    '[/\\\\]tests[/\\\\]',
  ],

  // Coverage configuration
  collectCoverageFrom: [
    'lib/**/*.js',
    '!**/node_modules/**',
    '!**/.homeybuild/**',
    '!**/vendor/**'
  ],

  // Coverage thresholds (NOTE: singular "coverageThreshold", not plural!)
  coverageThreshold: {
    global: {
      branches: 80,
      functions: 80,
      lines: 80,
      statements: 80
    }
  },

  // Verbose output
  verbose: true,

  // Coverage reporters
  coverageReporters: [
    'text',
    'text-summary',
    'html',
    'lcov'
  ],

  // Setup files
  setupFilesAfterEnv: [],

  // Module paths (if needed for Homey app structure)
  moduleDirectories: [
    'node_modules',
    'lib'
  ],

  // Clear mocks between tests
  clearMocks: true,

  // Timeout for tests (in milliseconds)
  testTimeout: 10000,

  // Root directory
  rootDir: '.'
};
