import validator from '../utils/validator';
import { request } from '../utils/network';
import { checkAdmin } from './user';
import { Form, UserAttributes, UserProfilePublicSettings, UserProfile, PublicUser } from '../Types';
import SkapiError from '../main/error';

export async function blockAccount (form: Form<{
    user_id: string;
    owner?: string;
    service?: string;
}>): Promise<'SUCCESS: The user has been blocked.'> {
    let params = validator.Params(form, {
        user_id: (v: string) => {
            return validator.UserId(v, '"user_id"');
        },
    }, ['user_id']);

    if (params?.service && params?.owner) {
        params = { service: params?.service, owner: params?.owner, block: params.user_id };
    } else {
        params = { block: params.user_id };
    }

    let isAdmin = await checkAdmin.bind(this)();

    if (!isAdmin) {
        if (!this.__user) {
            throw new SkapiError('User needs to login.', { code: 'INVALID_REQUEST' });
        }

        if (this.__user.access_group !== 99) {
            throw new SkapiError('Invalid access.', { code: 'INVALID_REQUEST' });
        }
    }

    return await request.bind(this)('block-account', params, { auth: true });
}

export async function unblockAccount (form: Form<{
    user_id: string;
    owner?: string;
    service?: string;
}>): Promise<'SUCCESS: The user has been unblocked.'> {
    let params = validator.Params(form, {
        user_id: (v: string) => {
            return validator.UserId(v, '"user_id"');
        },
    }, ['user_id']);

    if (params?.service && params?.owner) {
        params = { service: params?.service, owner: params?.owner, unblock: params.user_id };
    } else {
        params = { unblock: params.user_id };
    }

    let isAdmin = await checkAdmin.bind(this)();

    if (!isAdmin) {
        if (!this.__user) {
            throw new SkapiError('User needs to login.', { code: 'INVALID_REQUEST' });
        }

        if (this.__user.access_group !== 99) {
            throw new SkapiError('Invalid access.', { code: 'INVALID_REQUEST' });
        }
    }

    return await request.bind(this)('block-account', params, { auth: true });
}

export async function deleteAccount (form: Form<{
    user_id: string;
    owner?: string;
    service?: string;
}>): Promise<'SUCCESS: Account has been deleted.'> {
    let params = validator.Params(form, {
        user_id: (v: string) => {
            return validator.UserId(v, '"user_id"');
        },
    }, ['user_id']);

    if (params?.service && params?.owner) {
        params = { service: params?.service, owner: params?.owner, delete: params.user_id };
    } else {
        params = { delete: params.user_id };
    }

    let isAdmin = await checkAdmin.bind(this)();

    if (!isAdmin) {
        if (!this.__user) {
            throw new SkapiError('User needs to login.', { code: 'INVALID_REQUEST' });
        }

        if (this.__user.access_group !== 99) {
            throw new SkapiError('Invalid access.', { code: 'INVALID_REQUEST' });
        }
    }

    return await request.bind(this)('remove-account', params, { auth: true });
}

export async function inviteUser (
    form: Form<UserAttributes & UserProfilePublicSettings & { email: string; owner?: string; service?: string;}>, 
    options?: {
        confirmation_url?: string; // url 없으면 무조건 true
        email_subscription?: boolean;
    }
): Promise<'SUCCESS: Invitation has been sent.'> {
    let paramRestrictions = {
        email: (v: string) => validator.Email(v),
        password: (v: string) => validator.Password(v),
        
        name: 'string',
        username: 'string',
        gender: 'string',
        address: (v: any) => {
            if (!v) return '';
            
            if (typeof v === 'string') {
                return v;
            }
            
            if (typeof v === 'object') {
                return JSON.stringify(v);
            }
            
            return undefined;
        },
        birthdate: (v: string) => validator.Birthdate(v),
        phone_number: (v: string) => validator.PhoneNumber(v),
        picture: (v: string) => { if (v) return validator.Url(v); else return undefined },
        profile: (v: string) => { if (v) return validator.Url(v); else return undefined },
        website: (v: string) => { if (v) return validator.Url(v); else return undefined },
        nickname: 'string',
        misc: 'string',

        email_public: ['boolean', () => false],
        gender_public: ['boolean', () => false],
        address_public: ['boolean', () => false],
        birthdate_public: ['boolean', () => false],
        phone_number_public: ['boolean', () => false],
    };

    let params = validator.Params(form, paramRestrictions, ['email']);

    options = validator.Params(options, {
        confirmation_url: (v: string) => {
            let value = v;

            if (typeof v === 'string') {
                value = validator.Url(v);
            }
            else {
                throw new SkapiError('"options.confirmation_url" should be type: <string>.', { code: 'INVALID_PARAMETER' });
            }

            if (value && !params.email) {
                throw new SkapiError('"email" is required for signup confirmation.', { code: 'INVALID_PARAMETER' });
            }

            return value;
        },
        email_subscription: (v: boolean) => {
            if (typeof v !== 'boolean') {
                throw new SkapiError('"options.email_subscription" should be type: <boolean>.', { code: 'INVALID_PARAMETER' });
            }
            if (!options?.confirmation_url) {
                // requires to be url or true
                throw new SkapiError('"options.confirmation_url" is required for email subscription.', { code: 'INVALID_PARAMETER' });
            }
            return v;
        },
    });

    params.signup_confirmation = options?.confirmation_url || true;
    params.email_subscription = options?.email_subscription || false;

    let isAdmin = await checkAdmin.bind(this)();

    if (!isAdmin) {
        if (!this.__user) {
            throw new SkapiError('User needs to login.', { code: 'INVALID_REQUEST' });
        }

        if (this.__user.access_group !== 99) {
            throw new SkapiError('Invalid access.', { code: 'INVALID_REQUEST' });
        }
    }

    return await request.bind(this)('admin-signup', Object.assign({access_group: 1}, params), { auth: true });
}

export async function createUser (
    form: Form<
        UserAttributes & UserProfilePublicSettings & 
        { email: string; password: string; } & 
        { service?: string; owner?: string; }
    >,
    options?: {
        email_subscription?: boolean;
    }
): Promise<UserProfile & PublicUser & { email_admin: string; approved: string; log: number; username: string; }> {
    let paramRestrictions = {
        email: (v: string) => validator.Email(v),
        password: (v: string) => validator.Password(v),
        
        name: 'string',
        username: 'string',
        gender: 'string',
        address: (v: any) => {
            if (!v) return '';
            
            if (typeof v === 'string') {
                return v;
            }
            
            if (typeof v === 'object') {
                return JSON.stringify(v);
            }
            
            return undefined;
        },
        birthdate: (v: string) => validator.Birthdate(v),
        phone_number: (v: string) => validator.PhoneNumber(v),
        picture: (v: string) => { if (v) return validator.Url(v); else return undefined },
        profile: (v: string) => { if (v) return validator.Url(v); else return undefined },
        website: (v: string) => { if (v) return validator.Url(v); else return undefined },
        nickname: 'string',
        misc: 'string',

        email_public: ['boolean', () => false],
        gender_public: ['boolean', () => false],
        address_public: ['boolean', () => false],
        birthdate_public: ['boolean', () => false],
        phone_number_public: ['boolean', () => false],
    };

    let params = validator.Params(form, paramRestrictions, ['email', 'password']);

    options = validator.Params(options, {
        email_subscription: (v: boolean) => {
            if (typeof v !== 'boolean') {
                throw new SkapiError('"options.email_subscription" should be type: <boolean>.', { code: 'INVALID_PARAMETER' });
            }
            return v;
        },
    });

    params.email_subscription = options?.email_subscription || false;

    let isAdmin = await checkAdmin.bind(this)();

    if (!isAdmin) {
        if (!this.__user) {
            throw new SkapiError('User needs to login.', { code: 'INVALID_REQUEST' });
        }

        if (this.__user.access_group !== 99) {
            throw new SkapiError('Invalid access.', { code: 'INVALID_REQUEST' });
        }
    }

    return await request.bind(this)('admin-signup', Object.assign({access_group: 1}, params), { auth: true });
}

export async function grantAccess (params: Form<{
    user_id: string;
    access_group: number;
    service?: string;
    owner?: string;
}>): Promise<'SUCCESS: Access has been granted to the user.'> {
    params = validator.Params(params, {
        user_id: (v: string) => {
            return validator.UserId(v, '"user_id"');
        },
        access_group: (v: number) => {
            if (v > 0 && v < 100) {
                return v;
            } else {
                throw new SkapiError('"access_group" is invalid.', { code: 'INVALID_PARAMETER' });
            }
        }
    }, ['user_id', 'access_group']);

    let isAdmin = await checkAdmin.bind(this)();

    if (!isAdmin) {
        if (!this.__user) {
            throw new SkapiError('User needs to login.', { code: 'INVALID_REQUEST' });
        }

        if (this.__user.access_group !== 99) {
            throw new SkapiError('Invalid access.', { code: 'INVALID_REQUEST' });
        }
    }

    return await request.bind(this)('grant-access', params, { auth: true })
}