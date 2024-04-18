import {jest} from '@jest/globals';
import * as core from '@actions/core'
import githubHelper, {GitOutput, CHERRYPICK_UNRESOLVED_CONFLICT, CHERRYPICK_EMPTY} from '../src/github-helper';
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
    getOctokit: jest.fn().mockImplementation(() => {
      return {
        rest: {
          pulls: {
            create: jest.fn().mockImplementation(() => {
              return {
                data: {
                  number: '54',
                  html_url: ''
                }
              }
            })
          }
        }
      }
    }),
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


describe('for utility methods', () => {
  beforeEach(() => {
    mockedGetInputData = defaultMockedGetInputData;
  })
  
  afterEach(() => {
    jest.clearAllMocks()
  })

  test('getAllBranches', async () => {

    let stdBranches = "'origin/release/1.0.0'\n'origin/release/1.1.0'\n"
    jest.spyOn(githubHelper, 'gitExecution').mockImplementation(() => {
      const output: GitOutput = {
        stdout: stdBranches,
        stderr: '',
        exitCode: 0
      }
      return Promise.resolve(output)
    })    

    mockedGetInputData['branch'] = 'release'
    let branches = await githubHelper.getAllBranches(mockedGetInputData.branch)
    
    expect(githubHelper.gitExecution).toHaveBeenCalledWith(["for-each-ref", "--format='%(refname:short)'", `refs/remotes/origin/release`])
    expect(branches).toStrictEqual(['release/1.0.0', 'release/1.1.0'])

    stdBranches = ""
    branches = await githubHelper.getAllBranches(mockedGetInputData.branch)
    expect(branches).toStrictEqual([])
  })

  test('isBranchNewer', async () => {  
    expect(await githubHelper.isBranchNewer('release/1.1.0', 'release/1.1.1')).toBeTruthy()
    expect(await githubHelper.isBranchNewer('release/1.1.1', 'release/1.1.0')).toBeFalsy()
    expect(await githubHelper.isBranchNewer('release/1.1.0', 'release/1.1.0')).toBeFalsy()
    expect(await githubHelper.isBranchNewer('release/1.1.0', 'release/2.0.0')).toBeTruthy()
    expect(await githubHelper.isBranchNewer('release/1.1.0', 'release/3.0.0')).toBeTruthy()
    expect(await githubHelper.isBranchNewer('release/1.1.0', 'release/3.1.0')).toBeTruthy()
    expect(await githubHelper.isBranchNewer('release/2.1.0', 'release/3.0.1')).toBeTruthy()
    expect(await githubHelper.isBranchNewer('release/2.2.9', 'release/2.3.0')).toBeTruthy()
  })

  test('getNewerBranchesForCherryPick', async () => {
    
    jest.spyOn(githubHelper, 'getAllBranches').mockImplementation(() => {
      return Promise.resolve(allBranches)
    })

    let allBranches = ['release/1.0.0', 'release/1.1.0', 'release/1.1.1']
    let pattern = 'release'
    let currentBranch = 'release/1.0.0'
    let branches = await githubHelper.getNewerBranchesForCherryPick(pattern, currentBranch)
    
    expect(githubHelper.getAllBranches).toHaveBeenCalledWith(pattern)
    expect(branches).toStrictEqual(['release/1.1.0', 'release/1.1.1'])

    currentBranch = 'release/1.1.0'
    branches = await githubHelper.getNewerBranchesForCherryPick(pattern, currentBranch)
    expect(branches).toStrictEqual(['release/1.1.1'])

    currentBranch = 'release/1.1.1'
    branches = await githubHelper.getNewerBranchesForCherryPick(pattern, currentBranch)
    expect(branches).toStrictEqual([])

    currentBranch = 'release/1.0.1'
    branches = await githubHelper.getNewerBranchesForCherryPick(pattern, currentBranch)
    expect(branches).toStrictEqual(['release/1.1.0', 'release/1.1.1'])

    pattern = 'feature'
    currentBranch = 'feature/1.0.0'
    allBranches = ['feature/1.0.0', 'feature/1.1.0', 'feature/1.1.1']
    branches = await githubHelper.getNewerBranchesForCherryPick(pattern, currentBranch)
    expect(branches).toStrictEqual(['feature/1.1.0', 'feature/1.1.1'])

  })

  test('getCherryPickParams', async () => {
    let unresolvedConflict = false
    let githubSha = 'XXXXXX'
    let params = githubHelper.getCherryPickParams(unresolvedConflict, githubSha)
    expect(params).toStrictEqual(['cherry-pick', '-m', '1', '--strategy=recursive', '--strategy-option=theirs', githubSha])

    unresolvedConflict = true
    params = githubHelper.getCherryPickParams(unresolvedConflict, githubSha)
    expect(params).toStrictEqual(['cherry-pick', '-m', '1', '--strategy=recursive', githubSha])
  })

  test('cherryPick for happy path', async () => {
    const params = ['cherry-pick', '-m', '1', '--strategy=recursive', 'XXXXXX']
    jest.spyOn(githubHelper, 'getCherryPickParams').mockImplementation(() => {
      return params
    })

    jest.spyOn(githubHelper, 'gitExecution').mockImplementation(() => {
      const output: GitOutput = {
        stdout: '',
        stderr: '',
        exitCode: 0
      }
      return Promise.resolve(output)
    })

    mockedGetInputData['unresolvedConflict'] = false
    await githubHelper.cherryPick(mockedGetInputData, 'XXXXXX')
    expect(githubHelper.getCherryPickParams).toHaveBeenCalledWith(false, 'XXXXXX')
    expect(githubHelper.gitExecution).toHaveBeenCalledWith(params, true)
  })

  test('cherryPick for unresolved conflict', async () => {
    const params = ['cherry-pick', '-m', '1', '--strategy=recursive', 'XXXXXX']
    jest.spyOn(githubHelper, 'getCherryPickParams').mockImplementation(() => {
      return params
    })

    mockedGetInputData['unresolvedConflict'] = true
    jest.spyOn(githubHelper, 'gitExecution').mockImplementation(() => {
      const output: GitOutput = {
        stderr: CHERRYPICK_UNRESOLVED_CONFLICT,
        stdout: '',
        exitCode: 0
      }
      return Promise.resolve(output)
    })
    await githubHelper.cherryPick(mockedGetInputData, 'XXXXXX')
    expect(githubHelper.gitExecution).toHaveBeenCalledWith(['add', '.'])
    expect(githubHelper.gitExecution).toHaveBeenCalledWith(['commit', '-m', 'leave conflicts unresolved']) 

  })


  test('cherryPick for not unresolved conflict', async () => {
    const params = ['cherry-pick', '-m', '1', '--strategy=recursive', 'XXXXXX']
    jest.spyOn(githubHelper, 'getCherryPickParams').mockImplementation(() => {
      return params
    })

    jest.spyOn(githubHelper, 'gitExecution').mockImplementation(() => {
      const output: GitOutput = {
        stderr: CHERRYPICK_UNRESOLVED_CONFLICT,
        stdout: '',
        exitCode: 0
      }
      return Promise.resolve(output)
    })  
    
    mockedGetInputData['unresolvedConflict'] = false
    await githubHelper.cherryPick(mockedGetInputData, 'XXXXXX')
    expect(githubHelper.gitExecution).toHaveBeenCalledTimes(1)

  })

  test('cherryPick for emptiness with exit code 0', async () => {
    const params = ['cherry-pick', '-m', '1', '--strategy=recursive', 'XXXXXX']
    jest.spyOn(githubHelper, 'getCherryPickParams').mockImplementation(() => {
      return params
    })

    //lets test CHERRYPICK_EMPTY
    jest.spyOn(githubHelper, 'gitExecution').mockImplementation(() => {
      const output: GitOutput = {
        stderr: CHERRYPICK_EMPTY,
        stdout: '',
        exitCode: 0
      }
      return Promise.resolve(output)
    })

    mockedGetInputData['unresolvedConflict'] = false
    await githubHelper.cherryPick(mockedGetInputData, 'XXXXXX')
    expect(githubHelper.gitExecution).toHaveBeenCalledTimes(1)

  })

  test('cherryPick for emptiness with exit code different of 0', async () => {
    const params = ['cherry-pick', '-m', '1', '--strategy=recursive', 'XXXXXX']
    jest.spyOn(githubHelper, 'getCherryPickParams').mockImplementation(() => {
      return params
    })

    //lets test CHERRYPICK_EMPTY
    jest.spyOn(githubHelper, 'gitExecution').mockImplementation(() => {
      const output: GitOutput = {
        stderr: CHERRYPICK_EMPTY,
        stdout: '',
        exitCode: 10
      }
      return Promise.resolve(output)
    })

    mockedGetInputData['unresolvedConflict'] = false
    await githubHelper.cherryPick(mockedGetInputData, 'XXXXXX')
    expect(githubHelper.gitExecution).toHaveBeenCalledTimes(1)
  
  })

  test('cherryPick for throw exception', async () => {
    const params = ['cherry-pick', '-m', '1', '--strategy=recursive', 'XXXXXX']
    jest.spyOn(githubHelper, 'getCherryPickParams').mockImplementation(() => {
      return params
    })

    //lets test CHERRYPICK_EMPTY
    jest.spyOn(githubHelper, 'gitExecution').mockImplementation(() => {
      const output: GitOutput = {
        stderr: "random error",
        stdout: '',
        exitCode: 10
      }
      return Promise.resolve(output)
    })

    mockedGetInputData['unresolvedConflict'] = false
    await expect(githubHelper.cherryPick(mockedGetInputData, 'XXXXXX')).rejects.toThrow(`Unexpected error: random error`)
  
  })

})
