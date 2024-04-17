import {jest} from '@jest/globals';
import * as core from '@actions/core'
import {run} from '../src/index'
import {createPullRequest, cherryPick, gitExecution, getCherryPickParams, Inputs} from '../src/github-helper';
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

const mockedCherryPickParams: any = {
  'cherry-pick-branch': 'my-custom-branch',
  'title': 'new title',
  'body': 'new body',
  'labels': ['label1', 'label2'],
  'reviewers': [],
}

let mockedGetInputData: any = defaultMockedGetInputData


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
          merge_commit_sha: 'XXXXXX'
        } as PullRequest
      }
    }
  }
})


jest.mock("../src/github-helper", () => {
  // const original = jest.requireActual("../src/github-helper"); // Step 2.
  return {
    createPullRequest: jest.fn(),
    cherryPick: jest.fn(),
    gitExecution: jest.fn(),
    getCherryPickParams: jest.fn()
  };
});


(createPullRequest as jest.Mock).mockImplementation(() => {
  return mockedCreatePullRequestOutputData
});

(cherryPick as jest.Mock).mockImplementation(() => {
  core.info("Cherry pick")
  core.info("Cherry pick")
  core.info("Cherry pick")
  core.info("Cherry pick")
  core.info("Cherry pick")
  core.info("Cherry pick")
  core.info("Cherry pick")
  gitExecution([])
});

(gitExecution as jest.Mock).mockImplementation(() => {
core.info("Git execution")
});

(getCherryPickParams as jest.Mock).mockImplementation(() => {
return mockedCherryPickParams
});


describe('run main', () => {
  beforeEach(() => {
    mockedGetInputData = defaultMockedGetInputData;


    // (createPullRequest as jest.Mock).mockImplementation(() => {
    //   return mockedCreatePullRequestOutputData
    // });
  
    // (cherryPick as jest.Mock).mockImplementation(() => {
    //   core.info("Cherry pick")
    //   core.info("Cherry pick")
    //   core.info("Cherry pick")
    //   core.info("Cherry pick")
    //   core.info("Cherry pick")
    //   core.info("Cherry pick")
    //   core.info("Cherry pick")
    //   gitExecution([])
    // });
  
    // (gitExecution as jest.Mock).mockImplementation(() => {
    //   core.info("Git execution")
    // });
  
    // (getCherryPickParams as jest.Mock).mockImplementation(() => {
    //   return mockedCherryPickParams
    // });
  })

  afterEach(() => {
    jest.clearAllMocks()
  })

  const commonChecks = (targetBranch: string, cherryPickBranch: string) => {
    expect(core.startGroup).toHaveBeenCalledTimes(5)
    expect(core.startGroup).toHaveBeenCalledWith(
      'Configuring the committer and author'
    )
    expect(core.startGroup).toHaveBeenCalledWith('Fetch all branchs')
    expect(core.startGroup).toHaveBeenCalledWith(
      `Create new branch ${cherryPickBranch} from ${targetBranch}`
    )
    
    expect(core.startGroup).toHaveBeenCalledWith('Push new branch to remote')
    expect(core.startGroup).toHaveBeenCalledWith('Opening pull request')

    expect(core.endGroup).toHaveBeenCalledTimes(5)

    // TODO check params
    expect(createPullRequest).toHaveBeenCalledTimes(1)
    expect(cherryPick).toHaveBeenCalled()
  }

  test('valid execution with default new branch', async () => {
    await run()

    commonChecks('target-branch', 'cherry-pick-target-branch-XXXXXX')

    expect(createPullRequest).toHaveBeenCalledWith(
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
      'cherry-pick-target-branch-XXXXXX'
    )
  })

  test('valid execution with customized branch', async () => {
    mockedGetInputData['cherry-pick-branch'] = 'my-custom-branch'

    await run()

    commonChecks('target-branch', 'my-custom-branch')

    expect(createPullRequest).toHaveBeenCalledWith(
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
      'my-custom-branch'
    )
  })

  test('valid execution with pr overrides', async () => {
    mockedGetInputData['cherry-pick-branch'] = 'my-custom-branch'
    mockedGetInputData['title'] = 'new title'
    mockedGetInputData['body'] = 'new body'
    mockedGetInputData['labels'] = 'label1,label2'
    mockedGetInputData['reviewers'] = 'user1,user2,user3'

    await run()

    commonChecks('target-branch', 'my-custom-branch')

    expect(createPullRequest).toHaveBeenCalledWith(
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
      'my-custom-branch'
    )
  })
})


