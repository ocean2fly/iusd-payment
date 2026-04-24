import type { FastifyError, FastifyReply, FastifyRequest } from 'fastify'
import { pickLocale, translateMessage } from '../lib/i18n'

export function errorHandler(
  error: FastifyError | Error,
  request: FastifyRequest,
  reply: FastifyReply,
) {
  request.log.error(error)

  const locale = pickLocale(request.headers['accept-language'] as string | undefined)

  // Fastify validation errors
  if ('validation' in error && (error as FastifyError).validation) {
    return reply.status(400).send({
      error:   'VALIDATION_ERROR',
      message: translateMessage('VALIDATION_ERROR', locale, error.message),
    })
  }

  // Fastify statusCode
  const code = (error as FastifyError).statusCode
  if (code && code < 500) {
    return reply.status(code).send({
      error:   'REQUEST_ERROR',
      message: translateMessage('REQUEST_ERROR', locale, error.message),
    })
  }

  return reply.status(500).send({
    error:   'INTERNAL_SERVER_ERROR',
    message: translateMessage('INTERNAL_SERVER_ERROR', locale, 'An unexpected error occurred'),
  })
}
