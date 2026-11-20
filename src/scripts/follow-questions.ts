const key = 'second-ink:followed-questions';
type Follows = Record<string, string[]>;

function read(): Follows {
  try {
    const value = JSON.parse(localStorage.getItem(key) || '{}');
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      return Object.fromEntries(Object.entries(value).filter(([, ids]) => Array.isArray(ids) && ids.every((id) => typeof id === 'string'))) as Follows;
    }
  } catch { /* A feed is available when browser storage is unavailable. */ }
  return {};
}

const questions = Array.from(document.querySelectorAll<HTMLElement>('[data-question-follow]')).map((root) => ({
  root,
  id: root.dataset.questionFollow ?? '',
  essays: JSON.parse(root.dataset.questionEssays ?? '[]') as string[],
  button: root.querySelector<HTMLButtonElement>('[data-question-toggle]')!,
  status: root.querySelector<HTMLElement>('[data-question-status]')!,
}));

function render() {
  const follows = read();
  for (const { root, id, essays, button, status } of questions) {
    const following = Object.hasOwn(follows, id);
    const newEssays = following ? essays.filter((essay) => !follows[id].includes(essay)).length : 0;
    root.closest('[data-question-entry]')?.toggleAttribute('data-following', following);
    button.hidden = false;
    button.textContent = following ? 'Following here' : 'Follow here';
    button.setAttribute('aria-label', following ? 'Stop following this question on this device' : 'Follow this question on this device');
    button.setAttribute('aria-pressed', String(following));
    status.textContent = newEssays ? `${newEssays} new ${newEssays === 1 ? 'essay' : 'essays'}` : '';
  }
}

for (const { root, id, essays, button, status } of questions) {
  function save(follows: Follows) {
    try { localStorage.setItem(key, JSON.stringify(follows)); }
    catch { status.textContent = 'Use the RSS feed to follow this question.'; return; }
    render();
  }
  button.addEventListener('click', () => {
    const follows = read();
    if (Object.hasOwn(follows, id)) delete follows[id];
    else follows[id] = essays;
    save(follows);
  });
  for (const link of root.closest('[data-question-entry]')?.querySelectorAll<HTMLAnchorElement>('[data-question-essay]') ?? []) {
    link.addEventListener('click', () => {
      const follows = read();
      const idOfEssay = link.dataset.questionEssay;
      if (idOfEssay && Object.hasOwn(follows, id) && !follows[id].includes(idOfEssay)) save({ ...follows, [id]: [...follows[id], idOfEssay] });
    });
  }
}

window.addEventListener('storage', (event) => { if (event.key === key || !event.key) render(); });
window.addEventListener('pageshow', render);
render();
