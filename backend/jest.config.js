module.exports = {
  moduleFileExtensions: ['js', 'json', 'ts'],
  rootDir: '.',
  testRegex: '.*\\.(spec|test)\\.ts$',
  transform: { '^.+\\.(t|j)s$': 'ts-jest' },
  collectCoverageFrom: ['src/**/*.ts', '!src/main.ts', '!src/**/dto/**'],
  coverageDirectory: './coverage',
  testEnvironment: 'node',
  coverageThreshold: {
    './src/appointments/appointment-rules.ts': { branches: 90, functions: 100, lines: 100, statements: 100 },
    './src/security/data-protection.ts': { branches: 60, functions: 90, lines: 90, statements: 90 }
  }
};
