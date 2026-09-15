import * as changelogService from '../services/changelog.service.js';

export async function listChangelog(req, res, next) {
  try {
    const entries = await changelogService.listChangelog();
    return res.status(200).json(entries);
  } catch (err) {
    return next(err);
  }
}
