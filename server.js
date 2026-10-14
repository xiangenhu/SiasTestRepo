const http = require('node:http');

const port = process.env.PORT || 3000;

const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(`<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Algebra Practice</title>
    <style>
      body { font-family: Arial, sans-serif; max-width: 600px; margin: 60px auto; padding: 0 20px; line-height: 1.6; }
      fieldset { border: 1px solid #ccc; border-radius: 8px; padding: 20px; }
      label { display: block; margin: 10px 0; cursor: pointer; }
      button { margin-top: 16px; padding: 10px 16px; cursor: pointer; }
      #feedback { min-height: 2em; }
    </style>
  </head>
  <body>
    <h1>hello world</h1>
    <h2>Algebra Practice</h2>
    <form id="quiz">
      <fieldset>
        <legend>Solve for x: 2x + 3 = 11</legend>
        <label><input type="radio" name="answer" value="2" required> A. x = 2</label>
        <label><input type="radio" name="answer" value="3"> B. x = 3</label>
        <label><input type="radio" name="answer" value="4"> C. x = 4</label>
        <label><input type="radio" name="answer" value="7"> D. x = 7</label>
        <button type="submit">Check answer</button>
      </fieldset>
    </form>
    <p id="feedback" role="status" aria-live="polite"></p>
    <script>
      const quiz = document.getElementById('quiz');
      const feedback = document.getElementById('feedback');
      quiz.addEventListener('submit', (event) => {
        event.preventDefault();
        const answer = new FormData(quiz).get('answer');
        feedback.textContent = answer === '4'
          ? 'Correct! Subtract 3 from both sides to get 2x = 8, then divide by 2 to get x = 4.'
          : 'Not quite. Try subtracting 3 from both sides, then dividing by 2.';
      });
      quiz.addEventListener('change', () => { feedback.textContent = ''; });
    </script>
  </body>
</html>`);
});

server.listen(port, '0.0.0.0', () => {
  console.log(`Hello world app running at http://localhost:${port}`);
});
