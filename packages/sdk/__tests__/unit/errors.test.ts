import { IPayError } from '../../src/types/errors';

// TC-SDK-U13: IPayError types
describe('IPayError', () => {
  it('is an instance of Error', () => {
    const err = new IPayError('E_NULLIFIER_SPENT');
    expect(err).toBeInstanceOf(Error);
  });

  it('has correct code', () => {
    const err = new IPayError('E_NULLIFIER_SPENT');
    expect(err.code).toBe('E_NULLIFIER_SPENT');
  });

  it('E_NULLIFIER_SPENT is not retryable', () => {
    const err = new IPayError('E_NULLIFIER_SPENT');
    expect(err.retryable).toBe(false);
  });

  it('E_NULLIFIER_SPENT has httpStatus 409', () => {
    const err = new IPayError('E_NULLIFIER_SPENT');
    expect(err.httpStatus).toBe(409);
  });

  it('E_INVALID_MERKLE_ROOT is retryable', () => {
    const err = new IPayError('E_INVALID_MERKLE_ROOT');
    expect(err.retryable).toBe(true);
  });

  it('E_INSUFFICIENT_FUNDS has httpStatus 402', () => {
    const err = new IPayError('E_INSUFFICIENT_FUNDS');
    expect(err.httpStatus).toBe(402);
  });

  it('E_ADDRESS_NOT_FOUND has httpStatus 404', () => {
    const err = new IPayError('E_ADDRESS_NOT_FOUND');
    expect(err.httpStatus).toBe(404);
  });

  it('E_RETENTION_PERIOD_ACTIVE has httpStatus 403', () => {
    const err = new IPayError('E_RETENTION_PERIOD_ACTIVE');
    expect(err.httpStatus).toBe(403);
  });

  it('E_NOT_OWNER has httpStatus 403', () => {
    const err = new IPayError('E_NOT_OWNER');
    expect(err.httpStatus).toBe(403);
  });

  it('E_UNKNOWN_CHAIN has httpStatus 400', () => {
    const err = new IPayError('E_UNKNOWN_CHAIN');
    expect(err.httpStatus).toBe(400);
  });

  it('E_INVALID_PROOF has httpStatus 400', () => {
    const err = new IPayError('E_INVALID_PROOF');
    expect(err.httpStatus).toBe(400);
  });

  it('E_CHECK_EXPIRED has httpStatus 410', () => {
    const err = new IPayError('E_CHECK_EXPIRED');
    expect(err.httpStatus).toBe(410);
  });

  it('E_CHECK_CLAIMED has httpStatus 409', () => {
    const err = new IPayError('E_CHECK_CLAIMED');
    expect(err.httpStatus).toBe(409);
  });

  it('accepts custom message', () => {
    const err = new IPayError('E_NULLIFIER_SPENT', 'custom message');
    expect(err.message).toBe('custom message');
  });

  it('uses code as default message', () => {
    const err = new IPayError('E_NULLIFIER_SPENT');
    expect(err.message).toBe('E_NULLIFIER_SPENT');
  });

  it('accepts meta', () => {
    const err = new IPayError('E_NULLIFIER_SPENT', 'msg', undefined, undefined, { nullifier: '0x123' });
    expect(err.meta).toEqual({ nullifier: '0x123' });
  });

  it('can override httpStatus and retryable', () => {
    const err = new IPayError('E_NULLIFIER_SPENT', 'msg', 500, true);
    expect(err.httpStatus).toBe(500);
    expect(err.retryable).toBe(true);
  });
});
