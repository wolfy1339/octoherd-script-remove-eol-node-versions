import { YAMLMap, YAMLSeq, Scalar, Pair } from 'yaml';

// Root document (GitHub Actions YAML file)
export type GitHubActionsYAML = YAMLMap<
  number,
  | Pair<Scalar<'name'>, Scalar<string>>
  | Pair<Scalar<'on'>, OnMap>
  | Pair<Scalar<'permissions'>, PermissionsMap>
  | Pair<Scalar<'jobs'>, JobsMap>
>;

// "on" block (event triggers)
export type OnMap = YAMLMap<
  number,
  | Pair<Scalar<'push'>, PushMap>
  | Pair<Scalar<'pull_request'>, PullRequestMap>
>;

export type PushMap = YAMLMap<number, Pair<Scalar<'branches'>, YAMLSeq<Scalar<string>>>>;
export type PullRequestMap = YAMLMap<number, Pair<Scalar<'types'>, YAMLSeq<Scalar<string>>>>;

// "permissions" block
export type PermissionsMap = YAMLMap<number, Pair<Scalar<'contents'>, Scalar<'read' | 'write'>>>;

// "jobs" block (mapping of job names to job definitions)
export type JobsMap = YAMLMap<Scalar<string>, JobDefinition>;

// A job definition contains various properties
export type JobDefinition =
  | YAMLMap<Scalar<'strategy'>, StrategyMap>
  | YAMLMap<Scalar<'steps'>, YAMLSeq<StepDefinition>>
;

// "strategy" key inside a job
export type StrategyMap = YAMLMap<Scalar<'matrix'>, MatrixMap>;

// "matrix" key inside "strategy"
export type MatrixMap = YAMLMap<Scalar<'node'>, YAMLSeq<Scalar<number>>>;

// Steps list inside a job
export type StepDefinition = YAMLSeq<
  | YAMLMap<Scalar<'uses'>, Scalar<string>>
  | YAMLMap<Scalar<'run'>, Scalar<string>>
  | YAMLMap<Scalar<'with'>, WithMap> // Only present if `uses` exists
  | YAMLMap<Scalar<'env'>, EnvMap>
  | YAMLMap<Scalar<'if'>, Scalar<string>>
>;

export interface UsesWith extends YAMLMap {
  
}

// "with" block inside a step, only present if `uses` exists
export type WithMap = YAMLMap<number, Pair<Scalar<string>, Scalar<string>>>;

// "env" block inside a step
export type EnvMap = YAMLMap<number, Pair<Scalar<string>, Scalar<string>>>;
