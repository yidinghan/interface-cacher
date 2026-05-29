/* eslint-disable import/no-dynamic-require */
const path = require('path');
const { createRequire } = require('module');

const requireFromPath = (id, binPath) => {
  const nodeModules = path.dirname(binPath);
  return createRequire(path.join(nodeModules, '_optional.js'))(id);
};

const requireOptional = (id) => {
  try {
    return require(id);
  } catch (err) {
    if (err.code !== 'MODULE_NOT_FOUND') {
      throw err;
    }

    const value = process.env.PATH
      .split(path.delimiter)
      .filter((binPath) => binPath.endsWith(`${path.sep}.bin`))
      .map((binPath) => {
        try {
          return requireFromPath(id, binPath);
        } catch (pathErr) {
          return undefined;
        }
      })
      .find(Boolean);

    if (value) {
      return value;
    }

    throw err;
  }
};

module.exports = requireOptional;
