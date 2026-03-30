const { HttpError } = require("./http-error");
const { entityFilePath, listJson, readJsonIfExists, writeJsonAtomic } = require("./fs-store");

function createRepositories(paths) {
  const caches = new Map();

  function getDirectory(type) {
    const directory = paths.entityDirs[type];
    if (!directory) {
      throw new Error(`Unknown entity type: ${type}`);
    }
    return directory;
  }

  function getCache(type) {
    if (!caches.has(type)) {
      caches.set(type, new Map());
    }
    return caches.get(type);
  }

  async function save(type, entity) {
    if (!entity || !entity.id) {
      throw new Error(`Cannot save ${type} without an id`);
    }
    await writeJsonAtomic(entityFilePath(getDirectory(type), entity.id), entity);
    getCache(type).set(entity.id, structuredClone(entity));
    return entity;
  }

  async function get(type, id) {
    const cache = getCache(type);
    const value = await readJsonIfExists(entityFilePath(getDirectory(type), id));
    if (value) {
      cache.set(id, structuredClone(value));
      return structuredClone(value);
    }

    cache.delete(id);

    return undefined;
  }

  async function mustGet(type, id, label) {
    const value = await get(type, id);
    if (!value) {
      throw new HttpError(404, `${label} not found.`, "NOT_FOUND");
    }
    return value;
  }

  async function list(type) {
    const values = await listJson(getDirectory(type));
    const cache = getCache(type);
    cache.clear();

    for (const value of values) {
      cache.set(value.id, structuredClone(value));
    }

    return values.sort((left, right) => {
      const leftTime = Date.parse(left.createdAt || left.updatedAt || 0);
      const rightTime = Date.parse(right.createdAt || right.updatedAt || 0);
      return rightTime - leftTime;
    });
  }

  async function update(type, id, updater, label) {
    const current = await mustGet(type, id, label);
    const next = updater(structuredClone(current));
    if (!next || next.id !== id) {
      throw new Error(`Updater for ${type}:${id} must return the same entity id.`);
    }
    await save(type, next);
    return next;
  }

  return {
    save,
    get,
    mustGet,
    list,
    update,
  };
}

module.exports = {
  createRepositories,
};
