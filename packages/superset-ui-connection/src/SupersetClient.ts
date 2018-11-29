import callApi from './callApi';
import {
  ClientTimeout,
  Credentials,
  Headers,
  Host,
  Mode,
  SupersetClientResponse,
  RequestConfig,
} from './types';

type CsrfToken = string;
type CsrfPromise = Promise<string | undefined>;
type Protocol = 'http:' | 'https:';

export interface ClientConfig {
  credentials?: Credentials;
  csrfToken?: CsrfToken;
  headers?: Headers;
  host?: Host;
  protocol?: Protocol;
  mode?: Mode;
  timeout?: ClientTimeout;
}

class SupersetClient {
  credentials: Credentials;
  csrfToken: CsrfToken | undefined;
  csrfPromise: CsrfPromise;
  protocol: Protocol;
  host: Host;
  headers: Headers;
  mode: Mode;
  timeout: ClientTimeout;

  constructor({
    protocol = 'http:',
    host = 'localhost',
    headers = {},
    mode = 'same-origin',
    timeout,
    credentials = undefined,
    csrfToken = undefined,
  }: ClientConfig = {}) {
    this.headers = { ...headers };
    this.host = host;
    this.mode = mode;
    this.timeout = timeout;
    this.protocol = protocol;
    this.credentials = credentials;
    this.csrfToken = csrfToken;
    this.csrfPromise = Promise.reject({
      error: `SupersetClient has no CSRF token, ensure it is initialized or
      try logging into the Superset instance at ${this.getUrl({
        endpoint: '/login',
      })}`,
    });

    if (typeof this.csrfToken === 'string') {
      this.headers = { ...this.headers, 'X-CSRFToken': this.csrfToken };
      this.csrfPromise = Promise.resolve(this.csrfToken);
    }
  }

  init(force: boolean = false) {
    if (this.isAuthenticated() && !force) {
      return this.csrfPromise;
    }

    return this.getCSRFToken();
  }

  isAuthenticated() {
    // if CSRF protection is disabled in the Superset app, the token may be an empty string
    return this.csrfToken !== null && this.csrfToken !== undefined;
  }

  async get({
    body,
    credentials,
    headers,
    host,
    endpoint,
    mode,
    parseMethod,
    signal,
    timeout,
    url,
  }: RequestConfig): Promise<SupersetClientResponse> {
    return this.ensureAuth().then(() =>
      callApi({
        body,
        credentials: credentials || this.credentials,
        headers: { ...this.headers, ...headers },
        method: 'GET',
        mode: mode || this.mode,
        parseMethod,
        signal,
        timeout: timeout || this.timeout,
        url: this.getUrl({ endpoint, host, url }),
      }),
    );
  }

  async post({
    credentials,
    endpoint,
    headers,
    host,
    mode,
    parseMethod,
    postPayload,
    signal,
    stringify,
    timeout,
    url,
  }: RequestConfig): Promise<SupersetClientResponse> {
    return this.ensureAuth().then(() =>
      callApi({
        credentials: credentials || this.credentials,
        headers: { ...this.headers, ...headers },
        method: 'POST',
        mode: mode || this.mode,
        parseMethod,
        postPayload,
        signal,
        stringify,
        timeout: timeout || this.timeout,
        url: this.getUrl({ endpoint, host, url }),
      }),
    );
  }

  ensureAuth() {
    return this.csrfPromise;
  }

  async getCSRFToken() {
    this.csrfToken = undefined;

    // If we can request this resource successfully, it means that the user has
    // authenticated. If not we throw an error prompting to authenticate.
    this.csrfPromise = callApi({
      credentials: this.credentials,
      headers: {
        ...this.headers,
      },
      method: 'GET',
      mode: this.mode,
      timeout: this.timeout,
      url: this.getUrl({ endpoint: 'superset/csrf_token/' }),
    }).then(response => {
      if (typeof response.json === 'object') {
        this.csrfToken = response.json.csrf_token;
        if (typeof this.csrfToken === 'string') {
          this.headers = { ...this.headers, 'X-CSRFToken': this.csrfToken };
        }
      }

      if (!this.isAuthenticated()) {
        return Promise.reject({ error: 'Failed to fetch CSRF token' });
      }

      return Promise.resolve(this.csrfToken);
    });

    return this.csrfPromise;
  }

  getUrl({
    host: inputHost,
    endpoint = '',
    url,
  }: {
    endpoint?: string;
    host?: Host;
    url?: string;
  } = {}) {
    if (typeof url === 'string') return url;

    const host = inputHost || this.host;
    const cleanHost = host.slice(-1) === '/' ? host.slice(0, -1) : host; // no backslash

    return `${this.protocol}//${cleanHost}/${endpoint[0] === '/' ? endpoint.slice(1) : endpoint}`;
  }
}

let singletonClient: SupersetClient | undefined;

function hasInstance(maybeClient: SupersetClient | undefined): maybeClient is SupersetClient {
  if (!maybeClient) {
    throw new Error('You must call SupersetClient.configure(...) before calling other methods');
  }

  return true;
}

const PublicAPI = {
  configure: (config: ClientConfig = {}): SupersetClient => {
    singletonClient = new SupersetClient(config);

    return singletonClient;
  },
  get: (request: RequestConfig) => hasInstance(singletonClient) && singletonClient.get(request),
  init: (force?: boolean) => hasInstance(singletonClient) && singletonClient.init(force),
  isAuthenticated: () => hasInstance(singletonClient) && singletonClient.isAuthenticated(),
  post: (request: RequestConfig) => hasInstance(singletonClient) && singletonClient.post(request),
  reAuthenticate: () => hasInstance(singletonClient) && singletonClient.init(/* force = */ true),
  reset: () => {
    singletonClient = undefined;
  },
};

export { SupersetClient };

export default PublicAPI;