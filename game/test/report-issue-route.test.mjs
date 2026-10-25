import test from 'node:test'
import assert from 'node:assert/strict'
import { reportIssuePathFor, reportIssueHrefFor } from '../src/app/reportIssueRoute.ts'

test('issue board path follows the active game language', () => {
  assert.equal(reportIssuePathFor('zh-CN'), '/stats/report')
  assert.equal(reportIssuePathFor('en'), '/stats/en/report')
  assert.equal(reportIssuePathFor('fr'), '/stats/report')
})

test('development routes to the stats Worker port; production stays on the apex origin', () => {
  assert.equal(reportIssueHrefFor('zh-CN', true), 'http://127.0.0.1:5176/stats/report')
  assert.equal(reportIssueHrefFor('en', true), 'http://127.0.0.1:5176/stats/en/report')
  assert.equal(reportIssueHrefFor('en', false), '/stats/en/report')
  assert.equal(reportIssueHrefFor('zh-CN', false), '/stats/report')
})
