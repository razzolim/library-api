import * as flagsService from '../services/featureFlags.service.js';
import { requestContext } from '../lib/requestContext.js';

const FLAG_ERRORS = {
  INVALID_KEY: [422, 'admin.featureFlags.invalidKey'],
  INVALID_FIELDS: [422, 'admin.featureFlags.invalidFields'],
  DUPLICATE_KEY: [409, 'admin.featureFlags.duplicateKey'],
  NOT_FOUND: [404, 'admin.featureFlags.notFound'],
};

function sendFlagError(err, res, next) {
  const mapped = FLAG_ERRORS[err.code];
  if (!mapped) {
    return next(err);
  }
  return res.status(mapped[0]).json({ success: false, errorKey: mapped[1] });
}

export async function listFlags(req, res, next) {
  try {
    return res.status(200).json(await flagsService.listFlags());
  } catch (err) {
    return next(err);
  }
}

export async function createFlag(req, res, next) {
  try {
    const { data, errorCode } = flagsService.validateNewFlag(req.body);
    if (errorCode) {
      return sendFlagError({ code: errorCode }, res, next);
    }
    const flag = await flagsService.createFlag(req.user, data, requestContext(req));
    return res.status(201).json({ success: true, flag });
  } catch (err) {
    return sendFlagError(err, res, next);
  }
}

export async function updateFlag(req, res, next) {
  try {
    const { data, errorCode } = flagsService.validateFlagToggle(req.body);
    if (errorCode) {
      return sendFlagError({ code: errorCode }, res, next);
    }
    const flag = await flagsService.setFlagEnabled(req.user, req.params.key, data.enabled, requestContext(req));
    return res.status(200).json({ success: true, flag });
  } catch (err) {
    return sendFlagError(err, res, next);
  }
}

export async function deleteFlag(req, res, next) {
  try {
    await flagsService.deleteFlag(req.user, req.params.key, requestContext(req));
    return res.status(200).json({ success: true });
  } catch (err) {
    return sendFlagError(err, res, next);
  }
}
