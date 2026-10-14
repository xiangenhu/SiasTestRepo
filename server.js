const http = require('node:http');

const port = process.env.PORT || 3000;

const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(`<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Hello World</title>
  </head>
  <body>
    <h1>hello world</h1>
  </body>
</html>`);
});

server.listen(port, () => {
  console.log(`Hello world app running at http://localhost:${port}`);
});
