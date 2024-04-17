import {getOctokit, context} from '@actions/github'
import * as core from '@actions/core'
import { which } from '@actions/io'
import { exec } from '@actions/exec'
import {PullRequest} from '@octokit/webhooks-types'

const ERROR_PR_REVIEW_FROM_AUTHOR =
  'Review cannot be requested from pull request author'

  const CHERRYPICK_EMPTY =
  'The previous cherry-pick is now empty, possibly due to conflict resolution.'

const CHERRYPICK_UNRESOLVED_CONFLICT =
  'After resolving the conflicts, mark them with'

export interface Inputs {
  token: string
  committer: string
  author: string
  branch: string
  title?: string
  body?: string
  labels: string[]
  inherit_labels?: boolean
  assignees: string[]
  reviewers: string[]
  teamReviewers: string[]
  cherryPickBranch?: string
  force?: boolean
  unresolvedConflict?: boolean
}

export async function createPullRequest(
  inputs: Inputs,
  prBranch: string
): Promise<any> {
  const octokit = getOctokit(inputs.token)
  if (!context.payload) {
    core.info(`Error: no payload in github.context`)
    return
  }
  const pull_request = context.payload.pull_request as PullRequest
  if (process.env.GITHUB_REPOSITORY !== undefined) {
    const [owner, repo] = process.env.GITHUB_REPOSITORY.split('/')

    // Get PR title
    core.info(`Input title is '${inputs.title}'`)
    let title = inputs.title
    if (title === undefined || title === '') {
      title = pull_request.title
    } else {
      // if the title comes from inputs, we replace {old_title}
      // so use users can set `title: 'Cherry pick: {old_title}`
      title = title.replace('{old_title}', pull_request.title)
    }
    core.info(`Using title '${title}'`)

    // Get PR body
    core.info(`Input body is '${inputs.body}'`)
    let body = inputs.body
    if (body === undefined || body === '') {
      body = pull_request.body || undefined
    } else {
      // if the body comes from inputs, we replace {old_pull_request_id}
      // to make it easy to reference the previous pull request in the new
      body = body.replace(
        '{old_pull_request_id}',
        pull_request.number.toString()
      )
    }
    core.info(`Using body '${body}'`)

    // Create PR
    const pull = await octokit.rest.pulls.create({
      owner,
      repo,
      head: prBranch,
      base: inputs.branch,
      title,
      body
    })

    // Apply labels
    const appliedLabels = inputs.labels

    if (inputs.inherit_labels) {
      const prLabels = pull_request.labels
      if (prLabels) {
        for (const item of prLabels) {
          if (item.name !== inputs.branch) {
            appliedLabels.push(item.name)
          }
        }
      }
    }
    if (appliedLabels.length > 0) {
      core.info(`Applying labels '${appliedLabels}'`)
      await octokit.rest.issues.addLabels({
        owner,
        repo,
        issue_number: pull.data.number,
        labels: appliedLabels
      })
    }

    // Apply assignees
    if (inputs.assignees.length > 0) {
      core.info(`Applying assignees '${inputs.assignees}'`)
      await octokit.rest.issues.addAssignees({
        owner,
        repo,
        issue_number: pull.data.number,
        assignees: inputs.assignees
      })
    }

    // Request reviewers and team reviewers
    try {
      if (inputs.reviewers.length > 0) {
        core.info(`Requesting reviewers '${inputs.reviewers}'`)
        await octokit.rest.pulls.requestReviewers({
          owner,
          repo,
          pull_number: pull.data.number,
          reviewers: inputs.reviewers
        })
      }
      if (inputs.teamReviewers.length > 0) {
        core.info(`Requesting team reviewers '${inputs.teamReviewers}'`)
        await octokit.rest.pulls.requestReviewers({
          owner,
          repo,
          pull_number: pull.data.number,
          team_reviewers: inputs.teamReviewers
        })
      }
    } catch (e: unknown) {
      if (e instanceof Error) {
        if (e.message && e.message.includes(ERROR_PR_REVIEW_FROM_AUTHOR)) {
          core.warning(ERROR_PR_REVIEW_FROM_AUTHOR)
        } else {
          throw e
        }
      }
    }
    return pull
  }
}


export async function cherryPick(inputs: Inputs, githubSha: string | null): Promise<void> {
  const cherryPickParams = getCherryPickParams(inputs.unresolvedConflict ?? false, githubSha)
  const cherryPickMessage = `Cherry picking using ${inputs.unresolvedConflict ? 'theirs' : 'unresolved'} strategy`

  core.startGroup(cherryPickMessage)
  core.info('Cherry-pick started')

  const result = await gitExecution(cherryPickParams, inputs.unresolvedConflict ?? false)

  core.info('Cherry-pick done')

  if (inputs.unresolvedConflict && result.stderr.includes(CHERRYPICK_UNRESOLVED_CONFLICT)) {
    // commit the unresolved files and continue the cherry-pick
    await gitExecution(['add', '.'])
    await gitExecution(['commit', '-m', 'leave conflicts unresolved'])
  } else if (result.exitCode !== 0 && !result.stderr.includes(CHERRYPICK_EMPTY)) {
    throw new Error(`Unexpected error: ${result.stderr}`)
  }

  core.endGroup()
}

export function getCherryPickParams(unresolvedConflict: boolean, githubSha: string | null): string[] {
  const params: string[] = ['cherry-pick', '-m', '1', '--strategy=recursive']

  if (unresolvedConflict) {
    params.push('--strategy-option=theirs')
  }

  if (githubSha) {
    params.push(githubSha)
  }

  return params
}

export async function gitExecution(params: string[], ignoreReturnCode: boolean = false): Promise<GitOutput> {
  const result = new GitOutput()
  const stdout: string[] = []
  const stderr: string[] = []

  const options = {
    listeners: {
      stdout: (data: Buffer) => {
        stdout.push(data.toString())
      },
      stderr: (data: Buffer) => {
        stderr.push(data.toString())
      }
    },
    ignoreReturnCode
  }

  const gitPath = await which('git', true)
  result.exitCode = await exec(gitPath, params, options)
  result.stdout = stdout.join('')
  result.stderr = stderr.join('')

  if (result.exitCode === 0) {
    core.info(result.stdout.trim())
  } else {
    core.info(result.stderr.trim())
  }

  return result
}

class GitOutput {
  stdout = ''
  stderr = ''
  exitCode = 0
}