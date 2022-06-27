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
 * @typedef {object} Response
 * @property {boolean} updated
 * @property {boolean} deleted
 * @property {string} content
 */

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

  /**
   *
   * @param {Exclude<import('@octokit/openapi-types').components["schemas"]["content-tree"]['entries'], undefined>[number] | import('@octokit/openapi-types').components["schemas"]["content-tree"]} file
   */
  async function updateYamlFile(file) {
    octokit.log.info('Checking \'%s\' in \'%s\' repo', file.name, repo);

    if (
      file.content &&
        // @ts-expect-error
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
          // @ts-expect-error
          Buffer.from(file.content, 'base64').toString('utf-8')
      );

      /** @type {import('yaml').YAMLMap<string>} */
      // @ts-expect-error Why is this `unknown`?
      const jobs = yamlDocument.get('jobs');

      for (const { value: job, key: jobName } of jobs.items) {
        /** @type {import('yaml').YAMLSeq<number> | undefined} */
        const nodeVersions = job
            .get('strategy')
            ?.get('matrix')
            ?.get('node_version');

        if (nodeVersions) {
          yamlDocument.setIn(['jobs', jobName, 'strategy', 'matrix', 'node_version'], NODE_VERSIONS);
        }
      }

      // @ts-expect-error
      const { data: { commit }, updated } = await composeCreateOrUpdateTextFile(octokit, {
        owner,
        repo,
        path: `.github/workflows/${file.name}`,
        branch: branchName,
        message: `ci: stop testing against NodeJS ${NODE_VERSIONS_STRING}
  
          BREAKING CHANGES: Drop support for NodeJS ${NODE_VERSIONS_STRING}
          `,
        content: prettier.format(stringify(yamlDocument), { parser: 'yaml' })
      });

      octokit.log.info('Issue created for \'%s\': %s', repo, commit.html_url);

      return { commit, updated };
    }
    octokit.log.info(
        'The repository \'%s\' does not have any usage of node_version %s to be removed in its GitHub Actions',
        repo,
        `${NODE_VERSIONS_TO_REMOVE}`
    );

    return { commit: null, updated: false };
  }

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


  /** @type {Exclude<import('@octokit/openapi-types').components["schemas"]["content-tree"]['entries'], undefined> | [import('@octokit/openapi-types').components["schemas"]["content-tree"]]} */
  let files;

  // Get all files from .github/workflows folder
  try {
    /** @type {import('@octokit/types').OctokitResponse<import('@octokit/openapi-types').components["schemas"]["content-tree"]>} */
    // @ts-ignore Overriding the type of the response for the correct type with the `object` media type
    const { data } = await octokit.request(
        'GET /repos/{owner}/{repo}/contents/{path}',
        {
          owner,
          repo,
          path: PATH,
          mediaType: {
            format: 'object'
          }
        }
    );

    // We know that the path is a directory, we do this check to appease typescript and get rid of the `undefined`
    if (Array.isArray(data.entries)) {
      files = data.entries.filter(entry => isYamlFile(entry.name));
    } else {
      files = [data];
    }
  } catch (e) {
    if (e.status === 404) {
      octokit.log.warn(`"${PATH}" path not found in ${repository.full_name}`);

      return;
    }
    throw e;
  }

  const commits = [];

  if (files.length) {
    for (const file of files) {
      const { commit, updated } = await updateYamlFile(file);

      if (commit) {
        commits.push(commit);
      }
    }
  } else {
    octokit.log.info('There is no file %s in repository %s', PATH, repo);
  }

  // Update package.json
  // @ts-expect-error
  const { data: { commit: pkgCommit }, updated: pkgUpdated } = await composeCreateOrUpdateTextFile(octokit, {
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

      pkg['@pika/pack'].pipeline[1].append({
        minNodeVersion: '14'
      });

      return prettier.format(JSON.stringify(pkg), { parser: 'json-stringify' });
    }
  });

  if (pkgUpdated) {
    octokit.log.info(
        `package.json updated in ${repository.html_url} via ${pkgCommit.html_url}`
    );
  }

  if (!pkgUpdated && !updated) return;

  /** @type {import('@octokit/types').OctokitResponse<import('@octokit/openapi-types').components["schemas"]["pull-request-simple"][]>} */
  const { data: pulls } = await octokit.request('GET /repos/{owner}/{repo}/commits/{commit_sha}/pulls', {
    owner,
    repo,
    commit_sha: (commits[0] || pkgCommit).sha,
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
