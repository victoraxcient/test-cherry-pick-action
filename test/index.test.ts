import {jest} from '@jest/globals';
import * as core from '@actions/core'
import index from '../src/index'
import githubHelper from '../src/github-helper';
import {PullRequest} from '@octokit/webhooks-types'

const defaultMockedGetInputData: any = {
  token: 'whatever',
  author: 'Me <me@mail.com>',
  committer: 'Someone <someone@mail.com>',
  branch: 'target-branch',
  'cherry-pick-branch': ''
}

const mockedCreatePullRequestOutputData: any = {
  data: '{\n  "number" : "54"\n}'
}

let mockedGetInputData: any = defaultMockedGetInputData
let mockedNewerBranches: any = ['default-branch']

// create mock for createPullRequest
jest.mock('../src/github-helper', () => {
  return {
    createPullRequest: jest.fn().mockImplementation(() => {
      return {
        data: {
          number: '54',
          html_url: ''
        }
      }
    }),
    cherryPick: jest.fn(),
    gitExecution: jest.fn(),
    getCherryPickParams: jest.fn(),
    getNewerBranchesForCherryPick: jest.fn().mockImplementation(() => {
      return mockedNewerBranches
    })
  }
})

//mock utils
jest.mock('../src/utils', () => {
  const actual = jest.requireActual('../src/utils') as any
  return {
    ...actual,
    parseDisplayNameEmail: jest.fn().mockImplementation((name) => {
      return {
        name: name,
        email: name
      }
    })
  }
})

// default mock
jest.mock('@actions/core', () => {
  return {
    info: jest.fn(),
    setFailed: jest.fn().mockImplementation(msg => {
      throw new Error(msg as string)
    }),
    // redirect to stdout
    startGroup: jest.fn().mockImplementation(console.log),
    endGroup: jest.fn(),
    getInput: jest.fn().mockImplementation((name: unknown) => {
      return (name as string) in mockedGetInputData ? mockedGetInputData[name as string] : ''
    }),
    setOutput: jest.fn().mockImplementation(() => {
      return mockedCreatePullRequestOutputData
    })
  }
})

jest.mock('@actions/exec', () => {
  return {
    // 0 -> success
    exec: jest.fn<() => Promise<number>>().mockResolvedValue(0)
  }
})

jest.mock('@actions/github', () => {
  return {
    context: {
      payload: {
        pull_request: {
          merge_commit_sha: 'XXXXXX',
          base: {
            ref: 'target-branch'
          }
        } as PullRequest
      }
    }
  }
})



describe('creation of pull request', () => {
  beforeEach(() => {
    mockedGetInputData = defaultMockedGetInputData

    jest.spyOn(index, 'openPullRequest').mockImplementation(() => {
      return Promise.resolve()
    })
  })

  afterEach(() => {
    jest.clearAllMocks()
  })

  test('valid execution with default new branch', async () => {

    await index.run()

    expect(index.openPullRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        author: 'Me <me@mail.com>',
        committer: 'Someone <someone@mail.com>',
        branch: 'target-branch',
        title: '',
        body: '',
        labels: [],
        reviewers: [],
        cherryPickBranch: ''
      }),
      'cherry-pick-target-branch-XXXXXX',
      'target-branch'
    )
  })

  test('valid execution with customized branch', async () => {
    mockedGetInputData['cherry-pick-branch'] = 'my-custom-branch'

    await index.run()

    expect(index.openPullRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        author: 'Me <me@mail.com>',
        committer: 'Someone <someone@mail.com>',
        branch: 'target-branch',
        title: '',
        body: '',
        labels: [],
        reviewers: [],
        cherryPickBranch: 'my-custom-branch'
      }),
      'my-custom-branch',
      'target-branch'
    )
  })

  test('valid execution with pr overrides', async () => {
    mockedGetInputData['cherry-pick-branch'] = 'my-custom-branch'
    mockedGetInputData['title'] = 'new title'
    mockedGetInputData['body'] = 'new body'
    mockedGetInputData['labels'] = 'label1,label2'
    mockedGetInputData['reviewers'] = 'user1,user2,user3'

    await index.run()

    expect(index.openPullRequest).toHaveBeenCalledWith(
      expect.objectContaining({
        author: 'Me <me@mail.com>',
        committer: 'Someone <someone@mail.com>',
        branch: 'target-branch',
        title: 'new title',
        body: 'new body',
        labels: ['label1', 'label2'],
        reviewers: ['user1', 'user2', 'user3'],
        cherryPickBranch: 'my-custom-branch'
      }),
      'my-custom-branch',
      'target-branch'
    )
  })
})

describe('individual functions for index', () => {

  afterEach(() => {
    jest.clearAllMocks()
  })

  test('method getBranchesToCherryPick to return correct branches according to targetNextBranches', async () => {
    const inputs = index.parseInputs()

    mockedNewerBranches = ['mocked-branch', 'mocked-branch2']
    inputs.branch = 'target-branch'
    inputs.targetNextBranches = true

    const branches = await index.getBranchesToCherryPick(inputs, 'base-branch')
    expect(branches).toEqual(mockedNewerBranches)

    inputs.targetNextBranches = false
    const branches2 = await index.getBranchesToCherryPick(inputs, 'base-branch')

    expect(branches2).toEqual([inputs.branch])
  })

  test('method getPrBranchName to return correct branch name', () => {
    const inputs = index.parseInputs()
    const githubSha = 'XXXXXX'
    
    inputs.cherryPickBranch = ''
    inputs.branch = 'target-branch'

    const prBranch = index.getPrBranchName(inputs, inputs.branch, githubSha)
    expect(prBranch).toEqual(`cherry-pick-${inputs.branch}-${githubSha}`)

    inputs.cherryPickBranch = 'my-custom-branch'
    const prBranch2 = index.getPrBranchName(inputs, inputs.branch, githubSha)
    expect(prBranch2).toEqual('my-custom-branch')

  })

  test('method parseInputs to return correct inputs', () => {
    mockedGetInputData['token'] = 'whatever'
    mockedGetInputData['committer'] = 'Someone'
    mockedGetInputData['author'] = 'Me'
    mockedGetInputData['branch'] = 'target-branch'
    mockedGetInputData['title'] = 'new title'
    mockedGetInputData['body'] = 'new body'
    mockedGetInputData['force'] = 'true'
    mockedGetInputData['labels'] = 'label1,label2'
    mockedGetInputData['inherit_labels'] = 'true'
    mockedGetInputData['assignees'] = 'user1,user2'
    mockedGetInputData['reviewers'] = 'user3,user4'
    mockedGetInputData['team-reviewers'] = 'user5,user6'
    mockedGetInputData['cherry-pick-branch'] = 'my-custom-branch'
    mockedGetInputData['unresolved-conflict'] = 'true'
    mockedGetInputData['target-next-branches'] = 'true'

    const inputs = index.parseInputs()

    expect(inputs['token']).toEqual('whatever')
    expect(inputs['committer']).toEqual('Someone')
    expect(inputs['author']).toEqual('Me')
    expect(inputs['branch']).toEqual('target-branch')
    expect(inputs['title']).toEqual('new title')
    expect(inputs['body']).toEqual('new body')
    expect(inputs['force']).toEqual(true)
    expect(inputs['labels']).toEqual(['label1', 'label2'])
    expect(inputs['inherit_labels']).toEqual(true)
    expect(inputs['assignees']).toEqual(['user1', 'user2'])
    expect(inputs['reviewers']).toEqual(['user3', 'user4'])
    expect(inputs['teamReviewers']).toEqual(['user5', 'user6'])
    expect(inputs['cherryPickBranch']).toEqual('my-custom-branch')
    expect(inputs['unresolvedConflict']).toEqual(true)
    expect(inputs['targetNextBranches']).toEqual(true)
  })

  test('method openPullRequest to call createPullRequest with correct inputs', async () => {
    const inputs = index.parseInputs()
    const prBranch = 'cherry-pick-target-branch-XXXXXX'
    const branch = 'regular-branch'

    await index.openPullRequest(inputs, prBranch, branch)

    expect(githubHelper.createPullRequest).toHaveBeenCalledWith(
      expect.objectContaining(inputs),
      prBranch,
      branch)
  })

  test('method pushNewBranch to call gitExecution with correct inputs', async () => {
    const prBranch = 'cherry-pick-target-branch-XXXXXX'
    const force = true

    await index.pushNewBranch(prBranch, force)

    expect(githubHelper.gitExecution).toHaveBeenCalledWith(['push', '-u', 'origin', `${prBranch}`, '--force'])

    const force2 = false
    await index.pushNewBranch(prBranch, force2)

    expect(githubHelper.gitExecution).toHaveBeenCalledWith(['push', '-u', 'origin', `${prBranch}`])
  })

  test('method createNewBranch to call gitExecution with correct inputs', async () => {
    const prBranch = 'cherry-pick-target-branch-XXXXXX'
    const branch = 'target-branch'

    await index.createNewBranch(prBranch, branch)

    expect(githubHelper.gitExecution).toHaveBeenCalledWith(['checkout', '-b', prBranch, `origin/${branch}`])
  })

  test('method updateLocalBranches to call gitExecution with correct inputs', async () => {
    await index.updateLocalBranches()

    expect(githubHelper.gitExecution).toHaveBeenCalledWith(['remote', 'update'])
    expect(githubHelper.gitExecution).toHaveBeenCalledWith(['fetch', '--all'])
  })

  test('method configureCommiterAndAuthor to call gitExecution with correct inputs', async () => {
    const inputs = index.parseInputs()

    await index.configureCommiterAndAuthor(inputs)

    expect(githubHelper.gitExecution).toHaveBeenCalledWith(['config', '--global', 'user.name', inputs.author])
    expect(githubHelper.gitExecution).toHaveBeenCalledWith(['config', '--global', 'user.email', inputs.committer])
  })

})

