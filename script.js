// @ts-check
import { composeCreateOrUpdateTextFile } from '@octokit/plugin-create-or-update-text-file';
import prettier from 'prettier';
import { hasNodeVersionToRemove } from './utils/yaml-parser.js';
import { parseDocument, stringify } from 'yaml';

const PATH = '.github/workflows/test.yml';
const NODE_VERSIONS_TO_REMOVE = [10, 12];
const NODE_VERSIONS = [14, 16, 18];
const NODE_VERSIONS_STRING = NODE_VERSIONS_TO_REMOVE.map(e => `v${e}`).join(', ');

/**
 * Check if a filename is a YAML file
 *
 * @param {string} fileName FileName to be tested
 *
 * @return {boolean}
 */
const isYamlFile = fileName => /\.ya?ml$/.test(fileName);


/**
 * Creates an issue on each repo when a certain condition or group of conditions are accomplished
 *
 * @param {import('@octoherd/cli').Octokit} octokit
 * @param {import('@octoherd/cli').Repository} repository
 */
export async function script(octokit, repository) {
  if (repository.archived) {
    octokit.log.info(`${repository.html_url} is archived, ignoring.`);

    return;
  }

  // Global variables used throughout the code
  const owner = repository.owner.login;
  const repo = repository.name;
  const defaultBranch = repository.default_branch;
  const branchName = 'remove-eol-node-versions';

  // Get info on repository branches
  const { data: branches } = await octokit.request('GET /repos/{owner}/{repo}/branches', {
    owner,
    repo,
    branch: defaultBranch
  });

  // Get SHA of repository's default branch
  let sha = branches.filter(branch => branch.name === defaultBranch).map(branch => branch.commit.sha)[0];
  const branchExists = branches.some(branch => branch.name === branchName);

  // Create branch if not present
  if (!branchExists) {
    const ref = await octokit.request('POST /repos/{owner}/{repo}/git/refs', {
      owner,
      repo,
      ref: `refs/heads/${branchName}`,
      sha
    }).then(response => response.data.ref);

    if (!ref) {
      octokit.log.warn(`Error creating branch in ${repository.html_url}`);

      return;
    }
  } else {
    sha = branches.filter(branch => branch.name === branchName).map(branch => branch.commit.sha)[0];
  }


  let file;

  // Get all files from .github/workflows folder
  try {
    const { data } = await octokit.request(
        'GET /repos/{owner}/{repo}/contents/{path}',
        {
          owner,
          repo,
          path: PATH
        }
    );

    file = data;

    if (Array.isArray(file)) {
      throw new Error(
          `"${PATH}" should not be a folder in ${repository.full_name}`
      );
    }
  } catch (e) {
    if (e.status === 404) {
      octokit.log.warn(`"${PATH}" path not found in ${repository.full_name}`);

      return;
    }
    throw e;
  }

  if (file) {
    octokit.log.info('Checking \'%s\' in \'%s\' repo', file.name, repo);

    if (
      file.content &&
      hasNodeVersionToRemove(file.content, NODE_VERSIONS_TO_REMOVE)
    ) {
      octokit.log.warn(
          'The repository \'%s\' HAS a node_version %s to be removed in its GitHub Actions.\n %s',
          repo,
          `${NODE_VERSIONS_TO_REMOVE}`,
          repository.html_url
      );

      // Update Node versions used in GitHub Actions
      const yamlDocument = parseDocument(
        Buffer.from(file.content, 'base64').toString('utf-8')
      );
  
      const jobs = yamlDocument.get('jobs');
    
      for (const { value: job } of jobs.items) {
        const nodeVersions = job
            .get('strategy')
            ?.get('matrix')
            ?.get('node_version');

        if (nodeVersions) {
          job.setIn(['strategy', 'matrix', 'node_version'], nodeVersions);
        }
      }
      
      const { data: { commit }, updated } = await composeCreateOrUpdateTextFile(octokit, {
        owner,
        repo,
        path: `.github/workflows/${file.name}`,
        branch: branchName,
        message: `ci: stop testing against NodeJS ${NODE_VERSIONS_STRING}

        BREAKING CHANGES: Drop support for NodeJS ${NODE_VERSIONS_STRING}
        `,
        content: stringify(yamlDocument)
      });

      octokit.log.info('Issue created for \'%s\': %s', repo, data.html_url);
    } else {
      octokit.log.info(
          'The repository \'%s\' does not have any usage of node_version %s to be removed in its GitHub Actions',
          repo,
          `${NODE_VERSIONS_TO_REMOVE}`
      );
    }
  } else {
    octokit.log.info('There is no file %s in repository %s', PATH, repo);
  }

  // Update package.json
  const { data: { commit: pkgCommit }, updated: pkgUpdated } = composeCreateOrUpdateTextFile(octokit, {
    owner,
    repo,
    path: 'package.json',
    branch: branchName,
    message: 'build(package): set minimal node version in engines field to v14',
    content: ({ exists, content }) => {
      if (!exists) return null;

      const pkg = JSON.parse(content);

      pkg.engines ??= {};
      pkg.engines.node = `>= 14`;

      return prettier.format(JSON.stringify(pkg), { parser: 'json-stringify' });
    }
  });

  const pulls = await octokit.request('GET /repos/{owner}/{repo}/commits/{commit_sha}/pulls', {
    owner,
    repo,
    commit_sha: (commit || pkgCommit).sha,
    mediaType: {
      previews: [
        'groot'
      ]
    }
  });

  if (!pulls.length) {
    //
    // Pull Request
    //

    // Create pull request
    const { data: pr } = await octokit.request('POST /repos/{owner}/{repo}/pulls', {
      owner,
      repo,
      head: branchName,
      base: defaultBranch,
      title: `ci: stop testing against NodeJS ${NODE_VERSIONS_STRING}`,
      body: `BREAKING CHANGES: Drop support for NodeJS ${NODE_VERSIONS_STRING}`
    });

    octokit.log.info(`Create Pull Request at ${pr.html_url}`);

    // Add the "maintenance" label to the pull request
    await octokit.request('POST /repos/{owner}/{repo}/issues/{issue_number}/labels', {
      owner,
      repo,
      issue_number: pr.number,
      labels: ['maintenance']
    });
  }
}
