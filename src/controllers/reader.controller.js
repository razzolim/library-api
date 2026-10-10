import * as readerService from '../services/reader.service.js';

const ERRORS = {
  BOOK_NOT_FOUND: [404, 'reader.notFound'],
  INVALID_BOOKMARK: [400, 'reader.invalidBookmark'],
  BOOKMARK_LIMIT: [409, 'reader.bookmarkLimit'],
  BOOKMARK_NOT_FOUND: [404, 'reader.bookmarkNotFound'],
};

function fail(err, res, next) {
  const mapped = ERRORS[err.code];
  return mapped ? res.status(mapped[0]).json({ success: false, errorKey: mapped[1] }) : next(err);
}

const bookId = (req) => Number(req.params.id);

export async function getProgress(req, res, next) {
  try {
    return res.status(200).json(await readerService.getProgress(req.user.sub, bookId(req)));
  } catch (err) {
    return fail(err, res, next);
  }
}

export async function saveProgress(req, res, next) {
  try {
    const input = readerService.validateProgress(req.body);
    if (!input) {
      // Unknown books still win over validation errors, matching GET.
      await readerService.getProgress(req.user.sub, bookId(req));
      return res.status(400).json({ success: false, errorKey: 'reader.invalidProgress' });
    }
    const progress = await readerService.saveProgress(req.user.sub, bookId(req), input);
    return res.status(200).json({ success: true, progress });
  } catch (err) {
    return fail(err, res, next);
  }
}

export async function listReading(req, res, next) {
  try {
    const requested = Number.parseInt(req.query.limit, 10);
    const limit = Number.isInteger(requested) && requested >= 1 ? Math.min(requested, 50) : 10;
    return res.status(200).json({ items: await readerService.listReading(req.user.sub, limit) });
  } catch (err) {
    return next(err);
  }
}

export async function listBookmarks(req, res, next) {
  try {
    return res.status(200).json({ items: await readerService.listBookmarks(req.user.sub, bookId(req)) });
  } catch (err) {
    return fail(err, res, next);
  }
}

export async function createBookmark(req, res, next) {
  try {
    const { bookmark, created } = await readerService.createBookmark(req.user.sub, bookId(req), req.body);
    return res.status(created ? 201 : 200).json({ success: true, bookmark });
  } catch (err) {
    return fail(err, res, next);
  }
}

export async function deleteBookmark(req, res, next) {
  try {
    await readerService.deleteBookmark(req.user.sub, bookId(req), Number(req.params.bookmarkId));
    return res.status(200).json({ success: true });
  } catch (err) {
    return fail(err, res, next);
  }
}
