const express = require('express');
const app = express();
app.use(express.json());
app.use('/api/routing', require('./routes/document-routing'));
app.listen(4002, () => console.log('Test server on 4002'));