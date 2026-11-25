const defaultRepository = 'SaurabhDusane/blog-website';
const repositoryPath = /^[A-Za-z0-9-]+\/[A-Za-z0-9_.-]+$/;

export async function latestVerifiedRelease(repository = defaultRepository, request = fetch) {
  if (!repositoryPath.test(repository)) throw new Error('The live release repository is invalid.');
  const endpoint = `https://api.github.com/repos/${repository}/actions/workflows/verify-live.yml/runs?event=push&status=success&branch=main&per_page=1`;
  const response = await request(endpoint, {
    headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'Second-Ink-release-desk' },
    redirect: 'manual', signal: AbortSignal.timeout(5000),
  });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error('Could not check the verified live release.');
  const { workflow_runs: runs } = await response.json();
  const run = runs?.[0];
  if (!run || run.conclusion !== 'success' || run.event !== 'push' || run.head_branch !== 'main'
    || !/^[a-f0-9]{40}$/.test(run.head_sha) || !Number.isSafeInteger(run.id) || !Number.isFinite(Date.parse(run.updated_at))) return null;
  return { revision: run.head_sha, checkedAt: run.updated_at, url: `https://github.com/${repository}/actions/runs/${run.id}` };
}
