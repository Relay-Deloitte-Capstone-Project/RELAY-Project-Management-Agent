// Format/structure validation for the setup wizard's "Test connection"
// steps and the project detail panel's inline editors. Deliberately does
// NOT call Jira or GitHub — there's no way to verify credentials are real
// without a backend proxy that doesn't exist yet, and pretending to
// authenticate would be as fake as the "always passes" check this
// replaces. What's checkable without network access is the *shape* of what
// was typed: does this look like a real Jira Cloud URL, a real GitHub repo
// URL, a plausible email, a plausible project key — so at least a
// copy-pasted wrong link or a typo'd domain gets caught immediately.

const JIRA_URL_RE = /^https:\/\/[a-z0-9-]+\.atlassian\.net\/?$/i;
const JIRA_KEY_RE = /^[A-Z][A-Z0-9]{1,9}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const GITHUB_URL_RE = /^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\/?$/;

export function validateJira(fields: {
  baseUrl: string;
  projectKey: string;
  email: string;
  apiToken: string;
}): string | null {
  if (!JIRA_URL_RE.test(fields.baseUrl.trim())) {
    return "Base URL must look like https://yourcompany.atlassian.net";
  }
  if (!JIRA_KEY_RE.test(fields.projectKey.trim())) {
    return "Project key must be 2-10 uppercase letters/numbers, e.g. KAN";
  }
  if (!EMAIL_RE.test(fields.email.trim())) {
    return "Enter a valid email address";
  }
  if (fields.apiToken.trim() === "") {
    return "API token is required";
  }
  return null;
}

export function validateGithub(fields: { repoUrl: string; token: string }): string | null {
  if (!GITHUB_URL_RE.test(fields.repoUrl.trim())) {
    return "Repository URL must look like https://github.com/owner/repo";
  }
  if (fields.token.trim() === "") {
    return "Personal access token is required";
  }
  return null;
}
