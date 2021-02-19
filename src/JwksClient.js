import debug from 'debug';
import request from './wrappers/request';
import JwksError from './errors/JwksError';
import SigningKeyNotFoundError from './errors/SigningKeyNotFoundError';

import {
  retrieveSigningKeys
} from './utils';

import {
  cacheSigningKey,
  rateLimitSigningKey,
  getKeysInterceptor
} from './wrappers';

export class JwksClient {
  constructor(options) {
    this.options = {
      rateLimit: false,
      cache: true,
      timeout: 30000,
      ...options
    };
    this.logger = debug('jwks');

    // Initialize wrappers.
    if (this.options.getKeysInterceptor) {
      this.getSigningKey = getKeysInterceptor(this, options);
    }

    if (this.options.rateLimit) {
      this.getSigningKey = rateLimitSigningKey(this, options);
    }
    if (this.options.cache) {
      this.getSigningKey = cacheSigningKey(this, options);
    }

    if (this.options.rateLimit || this.options.cache) {
      this.getSigningKeyAsync = promisifyIt(this.getSigningKey, this);
    }
  }

  getKeys(cb) {
    this.logger(`Fetching keys from '${this.options.jwksUri}'`);
    request({
      uri: this.options.jwksUri,
      headers: this.options.requestHeaders,
      agent: this.options.requestAgent,
      timeout: this.options.timeout,
      fetcher: this.options.fetcher
    }).then((res) => {
      this.logger('Keys:', res.keys);
      return cb(null, res.keys);
    }).catch((err) => {
      const { errorMsg } = err;
      this.logger('Failure:', errorMsg || err);
      return cb(errorMsg ? new JwksError(errorMsg) : err);
    });
  }

  getSigningKeys(cb) {
    this.getKeys((err, keys) => {
      if (err) {
        return cb(err);
      }

      if (!keys || !keys.length) {
        return cb(new JwksError('The JWKS endpoint did not contain any keys'));
      }

      const signingKeys = retrieveSigningKeys(keys);

      if (!signingKeys.length) {
        return cb(new JwksError('The JWKS endpoint did not contain any signing keys'));
      }

      this.logger('Signing Keys:', signingKeys);
      return cb(null, signingKeys);
    });
  }

  getSigningKey = (kid, cb) => {
    this.logger(`Fetching signing key for '${kid}'`);
    this.getSigningKeys((err, keys) => {
      if (err) {
        return cb(err);
      }

      const kidDefined = kid !== undefined && kid !== null;
      if (!kidDefined && keys.length > 1) {
        this.logger('No KID specified and JWKS endpoint returned more than 1 key');
        return cb(new SigningKeyNotFoundError('No KID specified and JWKS endpoint returned more than 1 key'));
      }

      const key = keys.find(k => !kidDefined || k.kid === kid);
      if (key) {
        return cb(null, key);
      } else {
        this.logger(`Unable to find a signing key that matches '${kid}'`);
        return cb(new SigningKeyNotFoundError(`Unable to find a signing key that matches '${kid}'`));
      }
    });
  }

  /**
   * Get all keys. Use this if you prefer to use Promises or async/await.
   *
   * @example
   * client.getKeysAsync()
   *   .then(keys => { console.log(`Returned {keys.length} keys`); })
   *   .catch(err => { console.error('Error getting keys', err); });
   *
   * // async/await:
   * try {
   *  let keys = await client.getKeysAsync();
   * } catch (err) {
   *  console.error('Error getting keys', err);
   * }
   *
   * @return {Promise}
   */
  getKeysAsync = promisifyIt(this.getKeys, this);

  /**
   * Get all signing keys. Use this if you prefer to use Promises or async/await.
   *
   * @example
   * client.getSigningKeysAsync()
   *   .then(keys => { console.log(`Returned {keys.length} signing keys`); })
   *   .catch(err => { console.error('Error getting keys', err); });
   *
   * // async/await:
   * try {
   *  let keys = await client.getSigningKeysAsync();
   * } catch (err) {
   *  console.error('Error getting signing keys', err);
   * }
   *
   * @return {Promise}
   */
  getSigningKeysAsync = promisifyIt(this.getSigningKeys, this);

  /**
   * Get a signing key for a specified key ID (kid). Use this if you prefer to use Promises or async/await.
   *
   * @example
   * client.getSigningKeyId('someKid')
   *   .then(key => { console.log(`Signing key returned is {key.getPublicKey()}`); })
   *   .catch(err => { console.error('Error getting signing key', err); });
   *
   * // async/await:
   * try {
   *  let key = await client.getSigningKeyAsync('someKid');
   * } catch (err) {
   *  console.error('Error getting signing key', err);
   * }
   *
   * @param {String} kid   The Key ID of the signing key to retrieve.
   *
   * @return {Promise}
   */
  getSigningKeyAsync = promisifyIt(this.getSigningKey, this);
}

const promisifyIt = (fn, ctx) => (...args) => {
  return new Promise((resolve, reject) => {
    fn.call(ctx, ...args, (err, data) => {
      if (err) {
        reject(err);
      }
      resolve(data);
    });
  });
};
