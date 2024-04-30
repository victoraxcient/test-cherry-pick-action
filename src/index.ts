import * as core from '@actions/core'
import * as utils from './utils'
import * as github from '@actions/github'
import githubHelper, {Inputs} from './github-helper'
import {PullRequest} from '@octokit/webhooks-types'


const exportFunctions = {
  run,
  getBranchesToCherryPick,
  getPrBranchName,
  parseInputs,
  openPullRequest,
  pushNewBranch,
  createNewBranch,
  updateLocalBranches,
  configureCommiterAndAuthor
};

async function run(): Promise<void> {
  try {
    const pull_request = github.context.payload.pull_request as PullRequest
    // the value of merge_commit_sha changes depending on the status of the pull request
    // see https://docs.github.com/en/rest/pulls/pulls?apiVersion=2022-11-28#get-a-pull-request
    const githubSha = pull_request.merge_commit_sha

    const inputs: Inputs = parseInputs()

    await exportFunctions.configureCommiterAndAuthor(inputs)

    await exportFunctions.updateLocalBranches()

    const branches = await exportFunctions.getBranchesToCherryPick(inputs, pull_request.base.ref)

    core.info(`Branches to cherry pick into: ${branches}`)

    if (!branches) {
      console.log('No branches to cherry pick into')
      return
    }

    const originalLabels = [...inputs.labels]
    const originalDraft = pull_request.draft

    for (const branch of branches) {
      inputs.labels = [...originalLabels]
      inputs.draft = originalDraft

      core.info(`Cherry pick into branch ${branch}!`)

      const prBranch = exportFunctions.getPrBranchName(inputs, branch, githubSha)

      await exportFunctions.createNewBranch(prBranch, branch)

      await githubHelper.cherryPick(inputs, githubSha)

      await exportFunctions.pushNewBranch(prBranch, inputs.force)

      await exportFunctions.openPullRequest(inputs, prBranch, branch)
    }
  } catch (err: unknown) {
    if (err instanceof Error) {
      console.log(err)
      core.setFailed(err)
    }
  }
}

// do not run if imported as module
if (require.main === module) {
  run()
}

async function getBranchesToCherryPick(inputs: Inputs, base_ref: string): Promise<string[]>{
  return inputs.targetNextBranches ? githubHelper.getNewerBranchesForCherryPick(inputs.branch, base_ref) : [inputs.branch]
}

function getPrBranchName(inputs: Inputs, branch: string, githubSha: string | null) {
  return inputs.cherryPickBranch ? inputs.cherryPickBranch : `cherry-pick-${branch}-${githubSha}`
}

function parseInputs(): Inputs {
  return {
    token: core.getInput('token'),
    committer: core.getInput('committer'),
    author: core.getInput('author'),
    branch: core.getInput('branch'),
    title: core.getInput('title'),
    body: core.getInput('body'),
    force: utils.getInputAsBoolean('force'),
    labels: utils.getInputAsArray('labels'),
    inherit_labels: utils.getInputAsBoolean('inherit_labels'),
    assignees: utils.getInputAsArray('assignees'),
    reviewers: utils.getInputAsArray('reviewers'),
    teamReviewers: utils.getInputAsArray('team-reviewers'),
    cherryPickBranch: core.getInput('cherry-pick-branch'),
    unresolvedConflict: utils.getInputAsBoolean('unresolved-conflict'),
    targetNextBranches: utils.getInputAsBoolean('target-next-branches')
  }
}

async function openPullRequest(inputs: Inputs, prBranch: string, branch: string) {
  core.startGroup('Opening pull request')
  const pull = await githubHelper.createPullRequest(inputs, prBranch, branch)
  core.setOutput('data', JSON.stringify(pull.data))
  core.setOutput('number', pull.data.number)
  core.setOutput('html_url', pull.data.html_url)
  core.endGroup()
}

async function pushNewBranch(prBranch: string, force?: boolean) {
  core.startGroup('Push new branch to remote')
  if (force) {
    await githubHelper.gitExecution(['push', '-u', 'origin', `${prBranch}`, '--force'])
  } else {
    await githubHelper.gitExecution(['push', '-u', 'origin', `${prBranch}`])
  }
  core.endGroup()
}

async function createNewBranch(prBranch: string, branch: string) {
  core.startGroup(`Create new branch ${prBranch} from ${branch}`)
  await githubHelper.gitExecution(['checkout', '-b', prBranch, `origin/${branch}`])
  core.endGroup()
}

async function updateLocalBranches() {
  core.startGroup('Fetch all branches')
  await githubHelper.gitExecution(['remote', 'update'])
  await githubHelper.gitExecution(['fetch', '--all'])
  core.endGroup()
}

async function configureCommiterAndAuthor(inputs: Inputs) {
  core.startGroup('Configuring the committer and author')
  const parsedAuthor = utils.parseDisplayNameEmail(inputs.author)
  const parsedCommitter = utils.parseDisplayNameEmail(inputs.committer)
  core.info(
    `Configured git committer as '${parsedCommitter.name} <${parsedCommitter.email}>'`
  )
  await githubHelper.gitExecution(['config', '--global', 'user.name', parsedAuthor.name])
  await githubHelper.gitExecution([
    'config',
    '--global',
    'user.email',
    parsedCommitter.email
  ])
  core.endGroup()
}

export default exportFunctions;
