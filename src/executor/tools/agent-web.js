'use strict';

const axios = require('axios');
const cheerio = require('cheerio');
const TurndownService = require('turndown');

/**
 * Fetch webpage content and convert to markdown
 * @param {string} url - The URL to fetch
 * @param {Object} options - Optional parameters
 * @returns {Promise<Object>} Result with title, text, markdown, and raw HTML
 */
async function fetch(url, options = {}) {
  try {
    const response = await axios.get(url, {
      timeout: options.timeout || 15000,
      headers: {
        'User-Agent': options.userAgent || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
      }
    });

    const html = response.data;
    const $ = cheerio.load(html);

    // Remove script and style elements
    $('script, style').remove();

    // Get title
    const title = $('title').first().text().trim() || '';

    // Get text content
    const text = $('body').text().trim().replace(/\s+/g, ' ');

    // Convert to markdown
    const turndownService = new TurndownService();
    const markdown = turndownService.turndown($('body').html());

    return {
      title,
      text,
      markdown,
      html,
      url: response.request.res.responseUrl || url,
      statusCode: response.status
    };
  } catch (error) {
    throw new Error(`Failed to fetch ${url}: ${error.message}`);
  }
}

/**
 * Search the web using a search engine (defaults to DuckDuckGo HTML)
 * @param {string} query - The search query
 * @param {Object} options - Optional parameters
 * @returns {Promise<Array>} Array of search results
 */
async function web_search(query, options = {}) {
  try {
    // Use DuckDuckGo HTML for simplicity (no API key required)
    const searchUrl = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;

    const response = await axios.get(searchUrl, {
      timeout: options.timeout || 15000,
      headers: {
        'User-Agent': options.userAgent || 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36'
      }
    });

    const html = response.data;
    const $ = cheerio.load(html);
    const results = [];

    // DuckDuckGo result selectors
    $('.result__body').each((index, element) => {
      const $result = $(element);
      const title = $result.find('.result__title').first().text().trim();
      const snippet = $result.find('.result__snippet').first().text().trim();
      const url = $result.find('.result__url').first().text().trim();

      if (title && url) {
        results.push({
          title,
          snippet,
          url
        });
      }
    });

    // Limit results
    const maxResults = options.maxResults || 10;
    return results.slice(0, maxResults);
  } catch (error) {
    throw new Error(`Web search failed for query '${query}': ${error.message}`);
  }
}

function registerTools(executor) {
  executor.registerTool('fetch', fetch, 'Fetch webpage content and convert to markdown');
  executor.registerTool('web_search', web_search, 'Search the web and return results');
}

module.exports = { registerTools, fetch, web_search };