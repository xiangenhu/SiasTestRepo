const $ = id => document.getElementById(id);
const screens = [$('domain-form'), $('topic-form'), $('question-step')];
let question;
let busy = false;

function showStep(index) {
  screens.forEach((screen, i) => { screen.hidden = i !== index; });
  document.querySelectorAll('.steps li').forEach((step, i) => {
    if (i === index) step.setAttribute('aria-current', 'step');
    else step.removeAttribute('aria-current');
  });
  $('status').textContent = '';
  const target = index === 0 ? $('domain') : index === 1 ? $('subdomain') : $('question');
  if (index === 2) target.tabIndex = -1;
  target.focus();
}

$('domain-form').addEventListener('submit', event => {
  event.preventDefault();
  if (!$('domain').value.trim()) return $('domain').focus();
  $('domain-summary').textContent = 'Domain: ' + $('domain').value.trim();
  showStep(1);
});
$('back').addEventListener('click', () => showStep(0));
$('restart').addEventListener('click', () => showStep(0));

async function generate() {
  if (busy) return;
  if (!$('subdomain').value.trim()) return $('subdomain').focus();
  busy = true;
  document.querySelectorAll('button').forEach(button => { button.disabled = true; });
  $('status').textContent = 'Creating your question…';
  try {
    const response = await fetch('/api/question', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ domain: $('domain').value.trim(), subdomain: $('subdomain').value.trim() }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Could not generate a question. Please try again.');
    question = data;
    $('question').textContent = data.question;
    $('topic-summary').textContent = $('domain').value.trim() + ' / ' + $('subdomain').value.trim();
    $('choices').replaceChildren();
    data.choices.forEach((choice, index) => {
      const label = document.createElement('label');
      const input = document.createElement('input');
      input.type = 'radio'; input.name = 'answer'; input.value = index; input.required = true;
      label.append(input, document.createTextNode(' ' + String.fromCharCode(65 + index) + '. ' + choice));
      $('choices').append(label);
    });
    $('feedback').textContent = '';
    showStep(2);
  } catch (error) {
    $('status').textContent = error.message;
  } finally {
    busy = false;
    document.querySelectorAll('button').forEach(button => { button.disabled = false; });
  }
}
$('topic-form').addEventListener('submit', event => { event.preventDefault(); generate(); });
$('another').addEventListener('click', generate);
$('answer-form').addEventListener('submit', event => {
  event.preventDefault();
  const answer = Number(new FormData($('answer-form')).get('answer'));
  $('feedback').textContent = (answer === question.correctIndex ? 'Correct! ' : 'The correct answer is ' + String.fromCharCode(65 + question.correctIndex) + '. ' + question.choices[question.correctIndex] + '. ') + question.explanation;
});
$('answer-form').addEventListener('change', () => { $('feedback').textContent = ''; });
