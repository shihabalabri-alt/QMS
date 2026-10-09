const path = require('path');

module.exports = {
  port: process.env.PORT || 4000,
  jwtSecret: process.env.JWT_SECRET || 'qms-dev-secret-change-in-production',
  jwtExpiry: '8h',
  dataDir: path.join(__dirname, 'data'),
  uploadDir: path.join(__dirname, 'data', 'uploads'),
  dbFile: path.join(__dirname, 'data', 'qms.db'),
  maxUploadMb: 25,
  org: {
    name: 'QualiCore',
    standard: 'ISO 9001:2015 · ISO 13485:2016'
  },
  ai: {
    openaiKey: process.env.OPENAI_API_KEY || '',
    model: process.env.OPENAI_MODEL || 'gpt-4o-mini'
  },
  jobIntervalMinutes: 180
};
