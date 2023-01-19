/**
 * @ignore
 * BEGIN HEADER
 *
 * Contains:        runLanguageTool command
 * CVM-Role:        <none>
 * Maintainer:      Hendrik Erz
 * License:         GNU GPL v3
 *
 * Description:     This command runs LanguageTool over a document
 *
 * END HEADER
 */

import ZettlrCommand from './zettlr-command'
import got, { HTTPError } from 'got'
import { URLSearchParams } from 'url'
import { app } from 'electron'
import { trans } from '@common/i18n-main'

export interface LanguageToolAPIMatch {
  message: string // Long message (English)
  shortMessage: string
  replacements: Array<{ value: string }>
  offset: number
  length: number
  context: {
    text: string // Abbreviated text
    offset: number
    length: number
  }
  sentence: string // Full text
  type: {
    typeName: string
  }
  rule: {
    id: string
    description: string
    issueType: string // misspelling, grammar, etc
    category: {
      id: string
      name: string
    }
    isPremium: boolean
  }
  ignoreForIncompleteSentence: boolean
  contextForSureMatch: number
}

export interface LanguageToolAPIResponse {
  software: {
    name: string
    version: string
    buildDate: string
    apiVersion: number
    premium: boolean
    premiumHint?: string
    status: string
  }
  warnings: {
    incompleteResults: boolean
  }
  language: {
    name: string // Readable (English)
    code: string // bcp-47
    detectedLanguage: {
      name: string
      code: string
      confidence: number
      source: string
    }
  }
  matches: LanguageToolAPIMatch[]
  sentenceRanges: Array<[ number, number ]>
}

export default class LanguageTool extends ZettlrCommand {
  constructor (app: any) {
    super(app, 'run-language-tool')
  }

  /**
   * Fetches LanguageTool replies for a given text. It returns either an API
   * response, if everything went well, a string if there was a (possibly
   * fixable) error (such as using the official LanguageTool API and sending a
   * document with more than 20k or 80k characters), and undefined if something
   * to-be-expected happened (such as: the service is not even turned on in the
   * settings).
   *
   * @param   {string}                       evt  The event
   * @param   {string}                       arg  The text to check
   *
   * @return  {Promise<LanguageToolAPIResponse|string|undefined>}       The result
   */
  async run (evt: string, arg: string): Promise<LanguageToolAPIResponse|string|undefined> {
    const { languageTool } = this._app.config.getConfig().editor.lint
    if (!languageTool.active) {
      return undefined // LanguageTool is not active
    }

    const searchParams = new URLSearchParams({
      language: 'auto',
      text: arg,
      level: languageTool.level
    })

    // If users have Premium, they can do so by providing their username and API key
    if (languageTool.username.trim() !== '' && languageTool.apiKey.trim() !== '') {
      searchParams.set('username', languageTool.username)
      searchParams.set('apiKey', languageTool.apiKey)
    }

    let server = 'https://api.languagetool.org'
    if (languageTool.provider === 'custom' && languageTool.customServer.trim() !== '') {
      server = languageTool.customServer
    }

    if (server.endsWith('/')) {
      server = server.substring(0, server.length - 1)
    }

    const headers = {
      // NOTE: For debugging purposes, we send a custom User-Agent string. This
      // should help figure out potential problems in case Zettlr causes large
      // request flows to the official servers
      'User-Agent': `Zettlr/${app.getVersion()} (${process.platform}-${process.arch})`
    }

    try {
      // NOTE: Documentation at https://languagetool.org/http-api/#!/default/post_check
      const result = await got(`${server}/v2/check`, { method: 'post', body: searchParams.toString(), headers })
      return JSON.parse(result.body)
    } catch (err: any) {
      if (err instanceof HTTPError && err.code === 'ERR_NON_2XX_3XX_RESPONSE') {
        // The API complained. There are a few things that can happen, and here
        // we only translate them into error messages the users can understand.
        switch (err.message) {
          case 'Response code 413 (Request Entity Too Large)':
            return trans('Document too long')
          default:
            return err.message // This allows us to detect other error messages we need to translate
        }
      }

      this._app.log.error(`[Application] Error running LanguageTool: ${String(err.message)}`, err)
      return undefined // Silently swallow errors
    }
  }
}
