import axios from 'axios';
import dotenv from 'dotenv';

dotenv.config();

const NEXANO_API_URL = 'https://app.nexano.com.br/api/v1';
const PUBLIC_KEY = process.env.NEXANO_PUBLIC_KEY;
const SECRET_KEY = process.env.NEXANO_SECRET_KEY;

if (!PUBLIC_KEY || !SECRET_KEY) {
    console.warn('Nexano API keys not found in environment variables.');
}

export const nexanoClient = axios.create({
    baseURL: NEXANO_API_URL,
    headers: {
        'Content-Type': 'application/json',
        'x-public-key': PUBLIC_KEY,
        'x-secret-key': SECRET_KEY,
    },
});

export interface NexanoClientData {
    name: string;
    email: string;
    phone: string;
    document: string;
    address?: {
        country: string;
        state: string;
        city: string;
        neighborhood: string;
        zipCode: string;
        street: string;
        number: string;
        complement?: string;
    };
}

export interface NexanoProductData {
    id: string;
    name: string;
    quantity: number;
    price: number;
}

export interface NexanoSubscriptionData {
    periodicityType: 'MONTHS' | 'DAYS' | 'WEEKS' | 'YEARS';
    periodicity: number;
    firstChargeIn: number;
}

export interface NexanoPixSubscriptionRequest {
    identifier: string;
    amount: number;
    client: NexanoClientData;
    product: NexanoProductData;
    subscription: NexanoSubscriptionData;
    metadata?: Record<string, any>;
    callbackUrl?: string;
}

export interface NexanoCardSubscriptionRequest extends NexanoPixSubscriptionRequest {
    clientIp: string;
    card: {
        number: string;
        owner: string;
        expiresAt: string; // YYYY-MM
        cvv: string;
    };
}

export const createPixSubscription = async (data: NexanoPixSubscriptionRequest) => {
    const response = await nexanoClient.post('/gateway/pix/subscription', data);
    return response.data;
};

export const createCardSubscription = async (data: NexanoCardSubscriptionRequest) => {
    const response = await nexanoClient.post('/gateway/card/subscription', data);
    return response.data;
};
