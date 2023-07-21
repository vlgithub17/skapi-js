import {
    RecordData,
    Form,
    FormSubmitCallback,
    FetchOptions,
    DatabaseResponse,
    GetRecordQuery,
    Condition,
    PostRecordConfig,
    ProgressCallback
} from '../Types';
import SkapiError from '../main/error';
import { extractFormMeta, generateRandom } from '../utils/utils';
import validator from '../utils/validator';
import { request } from './request';
import { checkAdmin } from './user';

const __index_number_range = 4503599627370496; // +/-

function normalizeRecord(record: Record<string, any>): RecordData {
    function base_decode(chars) {
        let charset = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
        return chars.split('').reverse().reduce((prev, curr, i) =>
            prev + (charset.indexOf(curr) * (62 ** i)), 0);
    }

    const output: Record<string, any> = {
        user_id: '',
        record_id: '',
        updated: 0,
        uploaded: 0,
        table: {
            name: '',
            access_group: 0
        },
        reference: {
            reference_limit: null,
            allow_multiple_reference: true,
            referenced_count: 0
        },
        ip: '',
        bin: []
    };

    const keys = {
        'ip': (r: string) => {
            output.ip = r;
        },
        'rec': (r: string) => {
            if (!r) return;
            output.record_id = r;
            let base62timestamp = r.substring(0, r.length - 9); // id: [base62 timestamp][random 5 char][suid 4 char]
            let uploaded = base_decode(base62timestamp);
            output.uploaded = uploaded;
        },
        'usr': (r: string) => {
            output.user_id = r;
        },
        'tbl': (r: string) => {
            if (!r) return;
            let rSplit = r.split('/');
            // table/service/group(** | group)/[subscription(user id)/group(00 - 99)]/[tag]
            output.table.name = rSplit[0];
            output.table.access_group = rSplit[2] == '**' ? 'private' : parseInt(rSplit[2]);
            if (rSplit?.[3]) {
                output.table.subscription = {
                    user_id: rSplit[3],
                    group: parseInt(rSplit[4])
                };
            }
        },
        'usr_tbl': (r: string) => {
            // user-id/table/service/group(** | group)[/subscription(user id)/group(00 - 99)][/tag]
            let rSplit = r.split('/');
            output.user_id = rSplit[0];
            output.table.name = rSplit[1];
            output.table.access_group = rSplit[3] == '**' ? 'private' : parseInt(rSplit[3]);
            if (rSplit?.[4]) {
                output.table.subscription = {
                    user_id: rSplit[4],
                    group: parseInt(rSplit[5])
                };
            }
        },
        'idx': (r: string) => {
            if (!r) return;
            let rSplit = r.split('!');
            let name = rSplit.splice(0, 1)[0];
            let value = normalizeTypedString('!' + rSplit.join('!'));
            output.index = {
                name,
                value
            };
        },
        'ref': (r: string) => {
            if (!r) return;
            output.reference.record_id = r.split('/')[0];
        },
        'tags': (r: string[]) => {
            output.tags = r;
        },
        'upd': (r: number) => {
            output.updated = r;
        },
        'acpt_mrf': (r: boolean) => {
            output.reference.allow_multiple_reference = r;
        },
        'ref_limt': (r: number) => {
            output.reference.reference_limit = r;
        },
        'rfd': (r: number) => {
            output.reference.referenced_count = r;
        },
        'bin': (r: string[]) => {
            output.bin = r;
        },
        'data': (r: any) => {
            let data = r;
            if (r === '!D%{}') {
                data = {};
            }
            else if (r === '!L%[]') {
                data = [];
            }
            output.data = data;
        }
    };

    if (record.record_id) {
        // bypass already normalized records
        return record as RecordData;
    }

    for (let k in keys) {
        if (record.hasOwnProperty(k)) {
            keys[k](record[k]);
        }
    }

    return output as RecordData;
}

function normalizeTypedString(v: string) {
    let value = v.substring(3);
    let type = v.substring(0, 3);

    switch (type) {
        case "!S%":
            // !S%string
            return value;
        case "!N%":
            // !N%0
            return Number(value) - 4503599627370496;
        case "!B%":
            // !B%1
            return value === '1';
        case "!L%":
        case "!D%":
            // !L%[0, "hello"] / !D%{}
            try {
                return JSON.parse(value);
            } catch (err) {
                throw new SkapiError('Value parse error.', { code: 'PARSE_ERROR' });
            }
        default:
            return v;
    }
}

export async function deleteFiles(params: {
    /** @ignore */
    service?: string;
    endpoints: string | string[], // file endpoints
    /** @ignore */
    storage?: 'records' | 'host';
}) {
    let isAdmin = await checkAdmin.bind(this)();

    let { service = this.service, endpoints, storage = 'records' } = params;
    if (storage === 'host' && !isAdmin) {
        throw new SkapiError("No access", { code: 'INVALID_REQUEST' });
    }

    if (typeof endpoints === 'string') {
        endpoints = [endpoints];
    }

    if (!Array.isArray(endpoints)) {
        throw new SkapiError('"endpoints" should be type: array | string.', { code: 'INVALID_PARAMETER' });
    }

    if (storage !== 'host' && storage !== 'records') {
        throw new SkapiError('"storage" should be type: "records" | "host".', { code: 'INVALID_PARAMETER' });
    }

    return request.bind(this)('del-files', {
        service,
        endpoints,
        storage
    }, { auth: true, method: 'post' });
}

export async function uploadFiles(
    fileList: Form<FileList | File[]>,
    params: {
        service?: string;
        record_id: string; // Record ID of a record to upload files to. Not required if request is 'host'.
        request?: 'post' | 'host';
        progress: ProgressCallback;
    }
): Promise<{ completed: File[], failed: File[]; }> {
    // <input type="file" webkitdirectory multiple />
    // let input = document.querySelector('input[type="file"]');
    // let data = new FormData();

    // for (let i = 0; i < input.files.length; i++) {
    //     // You may want to replace '\\' with '/' if you're on Mac or Linux
    //     let path = input.files[i].webkitRelativePath || input.files[i].name;
    //     data.append('files', input.files[i], path);
    // }

    let isAdmin = await checkAdmin.bind(this)();

    if (fileList instanceof SubmitEvent) {
        fileList = (fileList.target as HTMLFormElement);
    }

    if (fileList instanceof HTMLFormElement) {
        fileList = new FormData(fileList);
    }

    if (fileList instanceof FormData) {
        // extract all fileList
        let fileEntries = [];

        for (let entry of fileList.entries()) {
            // let key = entry[0];
            let value = entry[1];
            if (value instanceof File) {
                fileEntries.push(value);
            }
        }

        fileList = fileEntries;
    }

    if (!(fileList[0] instanceof File)) {
        throw new SkapiError('"fileList" should be a FileList or array of File object.', { code: 'INVALID_PARAMETER' });
    }

    let reserved_key = generateRandom();

    let getSignedParams: Record<string, any> = {
        reserved_key,
        service: params?.service || this.service,
        request: params?.request || 'post'
    };

    if (getSignedParams.request === 'host' && !isAdmin) {
        throw new SkapiError('The user has no access.', { code: 'INVALID_REQUEST' });
    }

    if (params?.record_id) {
        getSignedParams.record_id = params.record_id;
    }
    else if (!isAdmin) {
        throw new SkapiError('Record ID is required.', { code: 'INVALID_PARAMETER' });
    }

    let xhr;
    let fetchProgress = (
        url: string,
        body: FormData,
        progressCallback
    ) => {
        return new Promise((res, rej) => {
            xhr = new XMLHttpRequest();
            xhr.open('POST', url);
            xhr.onload = (e: any) => {
                let result = xhr.responseText;
                try {
                    result = JSON.parse(result);
                }
                catch (err) { }
                if (xhr.status >= 200 && xhr.status < 300) {
                    let result = xhr.responseText;
                    try {
                        result = JSON.parse(result);
                    }
                    catch (err) { }
                    res(result);
                } else {
                    rej(result);
                }
            };
            xhr.onerror = () => rej('Network error');
            xhr.onabort = () => rej('Aborted');
            xhr.ontimeout = () => rej('Timeout');

            // xhr.addEventListener('error', rej);
            if (xhr.upload && typeof params.progress === 'function') {
                xhr.upload.onprogress = progressCallback;
            }

            xhr.send(body);
        });
    };

    let completed = [];
    let failed = [];

    function toBase62(num: number) {
        const base62Chars = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
        if (num === 0) return base62Chars[0];
        let result = '';
        while (num > 0) {
            result = base62Chars[num % 62] + result;
            num = Math.floor(num / 62);
        }
        return result;
    }

    for (let f of (fileList as FileList | File[])) {
        let signedParams = Object.assign({
            key: f.name,
            sizeKey: toBase62(f.size),
            contentType: f.type || null
        }, getSignedParams);

        let { fields = null, url } = await request.bind(this)('get-signed-url', signedParams, { auth: true });
        let form = new FormData();

        for (let name in fields) {
            form.append(name, fields[name]);
        }

        form.append('file', f);

        try {
            await fetchProgress(
                url, form,
                (p: ProgressEvent) => {
                    params.progress(
                        {
                            progress: p.loaded / p.total * 100,
                            currentFile: f,
                            completed,
                            failed,
                            loaded: p.loaded,
                            total: p.total,
                            abort: () => xhr.abort()
                        }
                    );
                }
            );
            completed.push(f);
        } catch (err) {
            failed.push(f);
        }
    }

    return { completed, failed };
}

export async function getFile(
    url: string,
    config?: {
        noCdn?: boolean;
        dataType?: 'base64' | 'download' | 'endpoint' | 'blob'; // endpoint returns url that can be shared outside your cors within a minimal time (1 min)
        expiration?: number;
        isHost?: boolean;
        progress?: ProgressCallback;
    }
): Promise<Blob | string> {
    validator.Url(url);

    let target_key = url.split('/').slice(3);
    let service = config?.isHost ? null : target_key[1];

    validator.Params(config, {
        expiration: ['number', () => 60],
        noCdn: ['boolean', () => false],
        isHost: ['boolean', () => false],
        dataType: ['base64', 'blob', 'endpoint', 'download', () => 'download']
    }, [], ['progress']);

    // [
    //     'publ',
    //     'ap22hF79vClHwWCcnbGE',
    //     'e8df73d9-b159-4adb-b288-0dd009724a7a',
    //     'ad7e9fb7-b0bb-4134-8921-04932b630885',
    //     'records',
    //     'ThF8oMtf4PjxtAgf',
    //     '00',
    //     'file',
    //     'd4bf2df6a8e5984f1a98b903ebd0b19a'
    // ]

    let getSignedUrl = async () => {
        let signed = await request.bind(this)('get-signed-url', {
            service,
            request: config?.isHost ? 'host' : 'get',
            record_id: target_key[5],
            key: url
        },
            { auth: true }
        );
        return signed.url;
    };

    let needAuth = target_key[0] == 'auth';

    if (config?.noCdn || config?.isHost || needAuth && (config?.dataType === 'download' || config?.dataType === 'endpoint')) {
        url = await getSignedUrl();
    }

    if (config?.dataType === 'download') {
        let a = document.createElement('a');
        // Set the href attribute to the file URL
        a.href = url;
        document.body.appendChild(a);
        a.setAttribute('download', '');
        a.click();
        document.body.removeChild(a);
        return null;
    }

    if (config?.dataType === 'endpoint') {
        return url;
    }

    let blob = await request.bind(this)(
        url,
        { service: service || this.service },
        { method: 'get', auth: needAuth, contentType: null, responseType: 'blob', progress: config?.progress }
    );

    if (config?.dataType === 'base64') {
        function blobToBase64(blob): Promise<any> {
            return new Promise((resolve, _) => {
                const reader = new FileReader();
                reader.onloadend = () => resolve(reader.result);
                reader.readAsDataURL(blob);
            });
        }

        return blobToBase64(blob);
    }

    return blob;
};

export async function getRecords(query: GetRecordQuery, fetchOptions?: FetchOptions): Promise<DatabaseResponse<RecordData>> {
    await this.__connection;

    const indexTypes = {
        '$updated': 'number',
        '$uploaded': 'number',
        '$referenced_count': 'number'
    };

    if (typeof query?.table === 'string') {
        query.table = {
            name: query.table,
            access_group: 0
        };
    }

    const struct = {
        table: {
            name: 'string',
            access_group: ['number', 'private', 'public', 'authorized'],
            subscription: {
                user_id: (v: string) => validator.UserId(v, 'User ID in "subscription.user_id"'),
                group: (v: number) => {
                    if (typeof v !== 'number') {
                        throw new SkapiError('"subscription.group" should be type: number.', { code: 'INVALID_PARAMETER' });
                    }
                    if (v > 99 || v < 0) {
                        throw new SkapiError('"subscription.group" should be within range: 0 ~ 99.', { code: 'INVALID_PARAMETER' });
                    }
                    return v;
                }
            }
        },
        reference: 'string',
        index: {
            name: (v: string) => {
                if (typeof v !== 'string') {
                    throw new SkapiError('"index.name" should be type: string.', { code: 'INVALID_PARAMETER' });
                }

                if (indexTypes.hasOwnProperty(v)) {
                    return v;
                }

                if (['$uploaded', '$updated', '$referenced_count', '$user_id'].includes(v)) {
                    return v;
                }

                return validator.specialChars(v, 'index.name', true, false);
            },
            value: (v: number | boolean | string) => {
                if (query.index?.name && indexTypes.hasOwnProperty(query.index.name)) {
                    let tp = indexTypes[query.index.name];

                    if (typeof v === tp) {
                        return v;
                    }

                    else {
                        throw new SkapiError(`"index.value" should be type: ${tp}.`, { code: 'INVALID_PARAMETER' });
                    }
                }

                if (typeof v === 'number') {
                    if (v > __index_number_range || v < -__index_number_range) {
                        throw new SkapiError(`Number value should be within range -${__index_number_range} ~ +${__index_number_range}`, { code: 'INVALID_PARAMETER' });
                    }
                    return v;
                }

                else if (typeof v === 'boolean') {
                    return v;
                }

                else {
                    // is string
                    if ('$user_id' == query.index?.name) {
                        return validator.UserId(v);
                    }

                    return validator.specialChars((v as string), 'index.value', false, true);
                }
            },
            condition: ['gt', 'gte', 'lt', 'lte', '>', '>=', '<', '<=', '=', 'eq', '!=', 'ne'],
            range: (v: number | boolean | string) => {
                if (!query.index || !('value' in query.index)) {
                    throw new SkapiError('"index.value" is required.', { code: 'INVALID_PARAMETER' });
                }

                if (query.index.name === '$record_id') {
                    throw new SkapiError(`Cannot do "index.range" on ${query.index.name}`, { code: 'INVALID_PARAMETER' });
                }

                if (typeof query.index.value !== typeof v) {
                    throw new SkapiError('"index.range" type should match the type of "index.value".', { code: 'INVALID_PARAMETER' });
                }

                if (typeof v === 'string') {
                    return validator.specialChars(v, 'index.value');
                }

                return v;
            }
        },
        tag: 'string',
        private_access_key: 'string'
    };

    if (query?.table) {
        if (query.table.access_group === 'public') {
            query.table.access_group = 0;
        }

        else if (query.table.access_group === 'authorized') {
            query.table.access_group = 1;
        }

        if (typeof query.table.access_group === 'number') {
            if (!this.__user) {
                if (0 < query.table.access_group) {
                    throw new SkapiError("User has no access", { code: 'INVALID_REQUEST' });
                }
            }

            else if (this.user.access_group < query.table.access_group) {
                throw new SkapiError("User has no access", { code: 'INVALID_REQUEST' });
            }
        }
    }

    if (query?.index && !query.index?.name) {
        throw new SkapiError('"index.name" is required when using "index" parameter.', { code: 'INVALID_REQUEST' });
    }

    if (query?.record_id) {
        validator.specialChars(query.record_id, 'record_id', false, false);
        let outputObj: Record<string, string> = { record_id: query.record_id };
        if (query?.service) {
            outputObj.service = query.service;
        }
        query = outputObj;
    }

    else {
        let ref_user: string;
        if (!this.session && query.table?.access_group === 'private') {
            throw new SkapiError('Unsigned users have no access to private records.', { code: 'INVALID_REQUEST' });
        }

        if (query.reference) {
            try {
                ref_user = validator.UserId(query?.reference);
            } catch (err) {
                // bypass error
            }

            // if (query.table?.access_group === 'private') {
            //     if (!ref_user) {
            //         // request private access key
            //         query.private_access_key = await requestPrivateRecordAccessKey.bind(this)(query.reference);
            //     }
            // }
        }

        query = validator.Params(query || {}, struct, ref_user ? [] : ['table']);
        if (query.table?.subscription && !this.session) {
            throw new SkapiError('Unsigned users have no access to subscription records.', { code: 'INVALID_REQUEST' });
        }
    }

    let auth = query.hasOwnProperty('access_group') && query.table.access_group ? true : !!this.__user;
    let result = await request.bind(this)(
        'get-records',
        query,
        {
            fetchOptions,
            auth,
            method: auth ? 'post' : 'get'
        }
    );

    for (let i in result.list) { result.list[i] = normalizeRecord(result.list[i]); };

    return result;
}

export async function postRecord(
    form: Form<Record<string, any>> | null | undefined,
    config: PostRecordConfig & FormSubmitCallback
): Promise<RecordData> {
    let isAdmin = await this.checkAdmin();
    if (!config) {
        throw new SkapiError('"config" argument is required.', { code: 'INVALID_PARAMETER' });
    }

    if (!this.user) {
        throw new SkapiError('Login is required.', { code: 'INVALID_REQUEST' });
    }

    let fetchOptions: Record<string, any> = {};

    if (typeof config?.formData === 'function') {
        fetchOptions.formData = config.formData;
        delete config.formData;
    }

    if (typeof config.table === 'string') {
        config.table = {
            name: config.table
        };

        if (!config.record_id) {
            config.table.access_group = 0;
        }
    }
    let progress = config.progress || null;
    config = validator.Params(config || {}, {
        record_id: 'string',
        table: {
            name: 'string',
            subscription_group: ['number', null],
            access_group: ['number', 'private', 'public', 'authorized']
        },
        reference: {
            record_id: ['string', null],
            reference_limit: (v: number) => {
                if (v === null) {
                    return null;
                }

                else if (typeof v === 'number') {
                    if (0 > v) {
                        throw new SkapiError(`"reference_limit" should be >= 0`, { code: 'INVALID_PARAMETER' });
                    }

                    if (v > 4503599627370546) {
                        throw new SkapiError(`"reference_limit" should be <= 4503599627370546`, { code: 'INVALID_PARAMETER' });
                    }

                    return v;
                }

                throw new SkapiError(`"reference_limit" should be type: <number | null>`, { code: 'INVALID_PARAMETER' });
            },
            allow_multiple_reference: 'boolean',
        },
        index: {
            name: 'string',
            value: ['string', 'number', 'boolean']
        },
        tags: (v: string | string[]) => {
            if (v === null) {
                return v;
            }

            if (typeof v === 'string') {
                return [v];
            }

            if (Array.isArray(v)) {
                for (let i of v) {
                    if (typeof i !== 'string') {
                        throw new SkapiError(`"tags" should be type: <string | string[]>`, { code: 'INVALID_PARAMETER' });
                    }

                    validator.specialChars(v, 'tag', false, true);
                }
                return v;
            }

            throw new SkapiError(`"tags" should be type: <string | string[]>`, { code: 'INVALID_PARAMETER' });
        }
    }, [], ['response', 'onerror', 'progress'], null);

    if (!config?.table && !config?.record_id) {
        throw new SkapiError('Either "record_id" or "table" should have a value.', { code: 'INVALID_PARAMETER' });
    }

    if (config.table) {
        if (config.table.access_group === 'public') {
            config.table.access_group = 0;
        }

        else if (config.table.access_group === 'authorized') {
            config.table.access_group = 1;
        }

        if (typeof config.table.access_group === 'number') {
            if (!isAdmin && this.user.access_group < config.table.access_group) {
                throw new SkapiError("User has no access", { code: 'INVALID_REQUEST' });
            }
        }

        if (!config.table.name) {
            throw new SkapiError('"table.name" cannot be empty string.', { code: 'INVALID_PARAMETER' });
        }

        if (isAdmin) {
            if (config.table.access_group === 'private') {
                throw new SkapiError('Service owner cannot write private records.', { code: 'INVALID_REQUEST' });
            }

            if (config.table.hasOwnProperty('subscription_group')) {
                throw new SkapiError('Service owner cannot write to subscription table.', { code: 'INVALID_REQUEST' });
            }
        }

        if (typeof config.table?.subscription_group === 'number' && config.table.subscription_group < 0 || config.table.subscription_group > 99) {
            throw new SkapiError("Subscription group should be within range: 0 ~ 99", { code: 'INVALID_PARAMETER' });
        }
    }

    // callbacks should be removed after checkparams
    delete config.response;
    delete config.onerror;

    if (config.index) {
        // index name allows periods. white space is invalid.
        if (!config.index.name || typeof config.index.name !== 'string') {
            throw new SkapiError('"index.name" is required. type: string.', { code: 'INVALID_PARAMETER' });
        }

        if (!['$uploaded', '$updated', '$referenced_count', '$user_id'].includes(config.index.name)) {
            validator.specialChars(config.index.name, 'index name', true);
        }

        if (!config.index.hasOwnProperty('value')) {
            throw new SkapiError('"index.value" is required.', { code: 'INVALID_PARAMETER' });
        }

        if (typeof config.index.value === 'string') {
            // index name allows periods. white space is invalid.
            validator.specialChars(config.index.value, 'index value', false, true);
        }

        else if (typeof config.index.value === 'number') {
            if (config.index.value > __index_number_range || config.index.value < -__index_number_range) {
                throw new SkapiError(`Number value should be within range -${__index_number_range} ~ +${__index_number_range}`, { code: 'INVALID_PARAMETER' });
            }
        }
    }

    let options: Record<string, any> = { auth: true };
    let postData = null;

    if ((form instanceof HTMLFormElement) || (form instanceof FormData) || (form instanceof SubmitEvent)) {
        let toConvert = (form instanceof SubmitEvent) ? form.target : form;
        let formData = !(form instanceof FormData) ? new FormData(toConvert as HTMLFormElement) : form;
        let formMeta = extractFormMeta(form);
        options.meta = config;

        if (Object.keys(formMeta.meta).length) {
            options.meta.data = formMeta.meta;
        }

        let formToRemove = {

        };

        for (let [key, value] of formData.entries()) {
            if (formMeta.meta.hasOwnProperty(key) && !(value instanceof Blob)) {
                let f = formData.getAll(key);
                let f_idx = f.indexOf(value);
                if (formToRemove.hasOwnProperty(key)) {
                    formToRemove[key].push(f_idx);
                }
                else {
                    formToRemove[key] = [f_idx];
                }
            }
        }

        if (Object.keys(formToRemove).length) {
            for (let key in formToRemove) {
                let values = formData.getAll(key);
                let val_len = values.length;
                while (val_len--) {
                    if (formToRemove[key].includes(val_len)) {
                        values.splice(val_len, 1);
                    }
                }
                formData.delete(key);
                for (let dat of values) {
                    formData.append(key, (dat as Blob), dat instanceof File ? dat.name : null);
                }
            }
        }

        postData = formData;
    }

    else {
        postData = Object.assign({ data: form }, config);
    }

    if (typeof progress === 'function') {
        fetchOptions.progress = progress;
    }

    if (Object.keys(fetchOptions).length) {
        Object.assign(options, { fetchOptions });
    }

    return normalizeRecord(await request.bind(this)('post-record', postData, options));
}

export async function getTables(
    /** If null fetch all list of tables. */
    query: {
        table: string;
        /** Condition operator of table name. */
        condition?: Condition;
    },
    fetchOptions?: FetchOptions
): Promise<DatabaseResponse<{
    number_of_records: number; // Number of records in the table
    table: string; // Table name
    size: number; // Table size
}>> {
    let res = await request.bind(this)('get-table', validator.Params(query || {}, {
        table: 'string',
        condition: ['gt', 'gte', 'lt', 'lte', '>', '>=', '<', '<=', '=', 'eq', '!=', 'ne']
    }), Object.assign({ auth: true }, { fetchOptions }));

    let convert = {
        'cnt_rec': 'number_of_records',
        'tbl': 'table',
        'srvc': 'service'
    };

    if (Array.isArray(res.list)) {
        for (let t of res.list) {
            for (let k in convert) {
                if (t.hasOwnProperty(k)) {
                    t[convert[k]] = t[k];
                    delete t[k];
                }
            }
        }
    }

    return res;
}

export async function getIndexes(
    query: {
        /** Table name */
        table: string;
        /** Index name. When period is at the end of name, querys nested index keys. */
        index?: string;
        /** Queries order by */
        order?: {
            /** Key name to order by. */
            by: 'average_number' | 'total_number' | 'number_count' | 'average_bool' | 'total_bool' | 'bool_count' | 'string_count' | 'index_name';
            /** Value to query. */
            value?: number | boolean | string;
            condition?: Condition;
        };
    },
    fetchOptions?: FetchOptions
): Promise<DatabaseResponse<{
    table: string; // Table name
    index: string; // Index name
    number_of_records: number; // Number of records in the index
    string_count: number; // Number of string type value
    number_count: number; // Number of number type value
    boolean_count: number; // Number of boolean type value
    total_number: number; // Sum of all numbers
    total_bool: number; // Number of true(boolean) values
    average_number: number; // Average of all numbers
    average_bool: number; // Percentage of true(boolean) values
}>> {
    let p = validator.Params(
        query || {},
        {
            table: 'string',
            index: (v: string) => validator.specialChars(v, 'index name', true, false),
            order: {
                by: [
                    'average_number',
                    'total_number',
                    'number_count',
                    'average_bool',
                    'total_bool',
                    'bool_count',
                    'string_count',
                    'index_name',
                    'number_of_records'
                ],
                value: ['string', 'number', 'boolean'],
                condition: ['gt', 'gte', 'lt', 'lte', '>', '>=', '<', '<=', '=', 'eq', '!=', 'ne']
            }
        },
        ['table']
    );

    if (p.hasOwnProperty('order')) {
        if (!p.order?.by) {
            throw new SkapiError('"order.by" is required.', { code: 'INVALID_PARAMETER' });
        }

        if (p.order.hasOwnProperty('condition') && !p.order.hasOwnProperty('value')) {
            throw new SkapiError('"value" is required for "condition".', { code: 'INVALID_PARAMETER' });
        }

        if (p.hasOwnProperty('index')) {
            if (p.index.substring(p.index.length - 1) !== '.') {
                throw new SkapiError('"index" should be a parent index name of the compound index when using "order.by"', { code: 'INVALID_PARAMETER' });
            }
        }
    }

    let res = await request.bind(this)(
        'get-index',
        p,
        Object.assign(
            { auth: true },
            { fetchOptions }
        )
    );

    let convert = {
        'cnt_bool': 'boolean_count',
        'cnt_numb': 'number_count',
        'totl_numb': 'total_number',
        'totl_bool': 'total_bool',
        'avrg_numb': 'average_number',
        'avrg_bool': 'average_bool',
        'cnt_str': 'string_count'
    };

    if (Array.isArray(res.list)) {
        res.list = res.list.map((i: Record<string, any>) => {
            let iSplit = i.idx.split('/');
            let resolved: Record<string, any> = {
                table: iSplit[1],
                index: iSplit[2],
                number_of_records: i.cnt_rec
            };

            for (let k in convert) {
                if (i?.[k]) {
                    resolved[convert[k]] = i[k];
                }
            }

            return resolved;
        });
    }

    return res;
}

export async function getTags(
    query: {
        /** Table name */
        table: string;
        /** Tag name */
        tag?: string;
        /** String query condition for tag name. */
        condition?: Condition;
    },
    fetchOptions?: FetchOptions
): Promise<DatabaseResponse<{
    table: string; // Table name
    tag: string; // Tag
    number_of_records: string; // Number records tagged
}>> {

    let res = await request.bind(this)(
        'get-tag',
        validator.Params(query || {},
            {
                table: 'string',
                tag: 'string',
                condition: ['gt', 'gte', 'lt', 'lte', '>', '>=', '<', '<=', '=', 'eq', '!=', 'ne']
            }
        ),
        Object.assign({ auth: true }, { fetchOptions })
    );

    if (Array.isArray(res.list)) {
        for (let i in res.list) {
            let item = res.list[i];
            let tSplit = item.tag.split('/');
            res.list[i] = {
                table: tSplit[1],
                tag: tSplit[0],
                number_of_records: item.cnt_rec
            };
        }
    }

    return res;
}

export async function deleteRecords(params: {
    /** @ignore */
    service?: string;
    /** Record ID(s) to delete. Table parameter is not needed when record_id is given. */
    record_id?: string | string[];
    table?: {
        /** Table name. */
        name: string;
        /** Access group number. */
        access_group?: number | 'private' | 'public' | 'authorized';
        /** @ignore */
        subscription?: string;
        subscription_group?: number;
    };
}): Promise<string> {
    let isAdmin = await this.checkAdmin();
    if (isAdmin && !params?.service) {
        throw new SkapiError('Service ID is required.', { code: 'INVALID_PARAMETER' });
    }

    if (params?.record_id) {
        return await request.bind(this)('del-records', {
            service: params.service || this.service,
            record_id: (v => {
                let id = validator.specialChars(v, 'record_id', false, false);
                if (typeof id === 'string') {
                    return [id];
                }

                if (id.length > 100) {
                    throw new SkapiError('"record_id" should not exceed 100 items.', { code: 'INVALID_PARAMETER' });
                }

                return id;
            })(params.record_id)
        }, { auth: true });
    }

    else {
        if (!params?.table) {
            if (isAdmin) {
                return null;
            }

            throw new SkapiError('Either "table" or "record_id" is required.', { code: 'INVALID_PARAMETER' });
        }

        let struct = {
            access_group: (v: number | 'private' | 'public' | 'authorized') => {
                if (typeof v === 'string' && ['private', 'public', 'authorized'].includes(v)) {
                    switch (v) {
                        case 'private':
                            return v;

                        case 'public':
                            return 0;

                        case 'authorized':
                            return 1;
                    }
                }

                else if (typeof v === 'number' && v >= 0 && v < 100) {
                    // if (!isAdmin && this.user.access_group < v) {
                    //     throw new SkapiError("User has no access", { code: 'INVALID_REQUEST' });
                    // }

                    return v;
                }

                throw new SkapiError('Invalid "table.access_group". Access group should be type <number (0~99) | "private" | "public" | "authorized">.', { code: 'INVALID_PARAMETER' });
            },
            name: 'string',
            subscription: (v: string) => {
                if (isAdmin) {
                    // admin targets user id
                    return validator.UserId((v as string), 'User ID in "table.subscription"');
                }

                throw new SkapiError('"table.subscription" is an invalid parameter key.', { code: 'INVALID_PARAMETER' });
            },
            subscription_group: (v: number) => {
                if (isAdmin && typeof params?.table?.subscription !== 'string') {
                    throw new SkapiError('"table.subscription" is required.', { code: 'INVALID_PARAMETER' });
                }

                if (typeof v === 'number') {
                    if (v >= 0 && v < 99) {
                        return v;
                    }
                }

                throw new SkapiError('Subscription group should be between 0 ~ 99.', { code: 'INVALID_PARAMETER' });
            }
        };

        params.table = validator.Params(params.table || {}, struct, isAdmin ? [] : ['name']);
    }

    return await request.bind(this)('del-records', params, { auth: true });
}

export async function grantPrivateRecordAccess(params: {
    record_id: string;
    user_id: string | string[];
}) {
    if (!params.record_id) {
        throw new SkapiError(`Record ID is required.`, { code: 'INVALID_PARAMETER' });
    }

    if (!params.user_id || Array.isArray(params.user_id) && !params.user_id.length) {
        throw new SkapiError(`User ID is required.`, { code: 'INVALID_PARAMETER' });
    }

    return recordAccess({
        record_id: params.record_id,
        user_id: params.user_id || null,
        execute: 'add'
    });
}

export async function removePrivateRecordAccess(params: {
    record_id: string;
    user_id: string | string[];
}) {
    if (!params.record_id) {
        throw new SkapiError(`Record ID is required.`, { code: 'INVALID_PARAMETER' });
    }

    if (!params.user_id || Array.isArray(params.user_id) && !params.user_id.length) {
        throw new SkapiError(`User ID is required.`, { code: 'INVALID_PARAMETER' });
    }

    return recordAccess({
        record_id: params.record_id,
        user_id: params.user_id || null,
        execute: 'remove'
    });
}

export async function listPrivateRecordAccess(params: {
    record_id: string;
    user_id: string | string[];
}) {
    return recordAccess({
        record_id: params.record_id,
        user_id: params.user_id || null,
        execute: 'list'
    });
}

export async function requestPrivateRecordAccessKey(record_id: string) {
    await request.bind(this)(
        'request-private-access-key',
        { record_id },
        { auth: true }
    );
}

async function recordAccess(params: {
    record_id: string;
    user_id: string | string[];
    execute: 'add' | 'remove' | 'list';
}) {
    let execute = params.execute;
    let req = validator.Params(params,
        {
            record_id: 'string',
            user_id: (v: string) => {
                if (!v) {
                    if (execute == 'list') {
                        return null;
                    }

                    throw new SkapiError(`User ID is required.`, { code: 'INVALID_PARAMETER' });
                }

                let id = validator.specialChars(v, 'user id', false, false);

                if (typeof id === 'string') {
                    return [id];
                }

                if (id.length > 100) {
                    throw new SkapiError(`Cannot process more than 100 users at once.`, { code: 'INVALID_REQUEST' });
                }

                return id;
            },
            execute: ['add', 'remove', 'list']
        },
        [
            'execute',
            'record_id',
            'user_id'
        ]
    );

    if (!req.user_id) {
        req.user_id = null;
    }

    await request.bind(this)(
        'grant-private-access',
        req,
        { auth: true }
    );
}

