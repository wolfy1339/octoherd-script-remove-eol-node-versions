// @ts-check
import { composeCreatePullRequest } from 'octokit-plugin-create-pull-request';
import prettier from 'prettier';
import { hasNodeVersionToRemove } from './utils/yaml-parser.js';
import { parseDocument, stringify } from 'yaml';

const PATH = '.github/workflows';
const NODE_VERSIONS_TO_REMOVE = [14, 16];
const NODE_VERSIONS = [18, 20];
const NODE_VERSIONS_STRING = NODE_VERSIONS_TO_REMOVE.map(e => `v${e}`).join(', ');

/**
 * @typedef {object} Response
 * @property {boolean} updated
 * @property {boolean} deleted
 * @property {string} content
 */

/**
 * @typedef {import('yaml').YAMLMap<YAMLStringScalar, import('yaml').YAMLMap<YAMLStringScalar, import('yaml').YAMLMap<YAMLStringScalar, YAMLNodeVersionMap>>>} YAMLWorkflow
 */

/**
 * @typedef {import('yaml').Scalar<string>} YAMLStringScalar
 */
/**
 * @typedef {import('yaml').YAMLMap<import('yaml').Scalar<'node' | 'node_version'>, YAMLNumberSequence>} YAMLNodeVersionMap
 */

/**
 * @typedef {import('yaml').YAMLSeq<import('yaml').Scalar<number>>} YAMLNumberSequence
 */

/**
 * Check if a filename is a YAML file
 * @param {string} fileName FileName to be tested
 * @return {boolean}
 */
const isYamlFile = fileName => /\.ya?ml$/.test(fileName);


/**
 * An octoherd script to remove EOL NodeJS versions from @octokit repositories
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
  const branchName = 'remove-eol-node-versions';
  /** @type {import('octokit-plugin-create-pull-request').createPullRequest.Changes[]} */
  const changes = [
    {
      files: {
        'package.json': ({ exists, encoding, content }) => {
          if (!exists) return null;

          const pkg = JSON.parse(Buffer.from(content, encoding).toString('utf-8'));

          pkg.engines ??= {};
          pkg.engines.node = `>= ${NODE_VERSIONS[0]}`;

          return prettier.format(JSON.stringify(pkg), { parser: 'json-stringify' });
        }
      },
      commit: `build(package): set minimal node version in engines field to v${NODE_VERSIONS[0]}
BREAKING CHANGE: Drop support for NodeJS ${NODE_VERSIONS_STRING}`,
      emptyCommit: false
    },
    {
      files: {
        'scripts/build.mjs': ({ exists, encoding, content }) => {
          if (!exists) return null;

          return prettier.format(Buffer.from(content, encoding)
              .toString('utf-8')
              .replace(
                  new RegExp(`node${NODE_VERSIONS_TO_REMOVE.join('|')}`, 'g'),
                  `node${NODE_VERSIONS[0]}`
              )
          );
        }
      },
      commit: `build: set minimal node version in build script to v${NODE_VERSIONS[0]}`

    }
  ];

  /**
   * @param {Exclude<import('@octokit/openapi-types').components["schemas"]["content-tree"]['entries'], undefined>[number] | import('@octokit/openapi-types').components["schemas"]["content-tree"]} file
   * @param {import('octokit-plugin-create-pull-request').createPullRequest.UpdateFunctionFile} options
   * @return {string | null}
   */
  function updateYamlFile(file, { content, encoding, exists }) {
    if (!exists) return null;

    octokit.log.info('Checking \'%s\' in \'%s\' repo', file.name, repo);

    if (hasNodeVersionToRemove(content, NODE_VERSIONS_TO_REMOVE)) {
      octokit.log.warn(
          'The repository \'%s\' HAS a node_version %s to be removed in its GitHub Actions.\n %s',
          repo,
          `${NODE_VERSIONS_TO_REMOVE}`,
          repository.html_url
      );

      // Update Node versions used in GitHub Actions
      const yamlDocument = parseDocument(
          Buffer.from(content, encoding).toString('utf-8')
      );

      /** @type {YAMLWorkflow} */
      // @ts-expect-error Why is this `unknown`?
      const jobs = yamlDocument.get('jobs');

      for (const { value: job, key: jobName } of jobs.items) {
        const matrix = job
            ?.get('strategy')
            ?.get('matrix');

        const nodeVersions = matrix?.items.find(({ key }) => key.value === 'node' || key.value === 'node_version');

        if (nodeVersions) {
          yamlDocument.setIn(['jobs', jobName, 'strategy', 'matrix', nodeVersions.key.value], NODE_VERSIONS);
        }
      }

      return prettier.format(stringify(yamlDocument), { parser: 'yaml' });
    }
    octokit.log.info(
        'The repository \'%s\' does not have any usage of node_version %s to be removed in its GitHub Actions',
        repo,
        `${NODE_VERSIONS_TO_REMOVE}`
    );

    return Buffer.from(content, encoding).toString('utf-8');
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

  if (files.length) {
    for (const file of files) {
      changes.push({
        files: {
          [`.github/workflows/${file.name}`]: updateYamlFile.bind(null, file)
        },
        commit: `ci: stop testing against NodeJS ${NODE_VERSIONS_STRING}`,
        emptyCommit: false
      });
    }
  } else {
    octokit.log.info('There is no file %s in repository %s', PATH, repo);
  }

  //
  // Pull Request
  //

  const pr = await composeCreatePullRequest(octokit, {
    owner,
    repo,
    title: `ci: stop testing against NodeJS ${NODE_VERSIONS_STRING}`,
    body: `BREAKING CHANGE: Drop support for NodeJS ${NODE_VERSIONS_STRING}`,
    head: branchName,
    changes,
    createWhenEmpty: false,
    update: true
  });


  if (pr) {
    const { data: { number, html_url } } = pr;

    octokit.log.info(`Pull request created: ${html_url}`);

    octokit.request('POST /repos/{owner}/{repo}/issues/{issue_number}/labels', {
      owner,
      repo,
      issue_number: number,
      labels: ['Type: Maintenance', 'Type: Breaking Change']
    });
  }
}
