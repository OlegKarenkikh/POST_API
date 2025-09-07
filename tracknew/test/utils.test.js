const { expect } = require('chai');
const {
  validateCredentials,
  validateSingleTrack,
  validateBatchTrack,
  validateTicket
} = require('../utils');

describe('validation helpers', () => {
  const malicious = JSON.parse('{ "__proto__": { "polluted": true } }');

  it('rejects non-string credentials and prevents prototype pollution', () => {
    expect(validateCredentials(malicious, 'secret')).to.be.false;
    expect({}.polluted).to.be.undefined;
  });

  it('validates credential strings', () => {
    expect(validateCredentials('user', 'pass')).to.be.true;
    expect(validateCredentials('user', '')).to.be.false;
  });

  it('validates single tracking numbers', () => {
    expect(validateSingleTrack('123')).to.be.true;
    expect(validateSingleTrack('')).to.be.false;
    expect(validateSingleTrack(malicious)).to.be.false;
  });

  it('validates batch tracking arrays', () => {
    expect(validateBatchTrack(['a', 'b'])).to.be.true;
    expect(validateBatchTrack(['', 'b'])).to.be.false;
    expect(validateBatchTrack([malicious])).to.be.false;
  });

  it('validates ticket strings', () => {
    expect(validateTicket('t')).to.be.true;
    expect(validateTicket('')).to.be.false;
    expect(validateTicket(malicious)).to.be.false;
  });
});
