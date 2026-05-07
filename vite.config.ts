import { defineConfig } from 'vite';

const repoName = process.env.GITHUB_REPOSITORY?.split('/')[1] ?? 'Rose-Camellia';
const isGithubActions = process.env.GITHUB_ACTIONS === 'true';

export default defineConfig({
  base: isGithubActions ? `/${repoName}/` : '/',
});
