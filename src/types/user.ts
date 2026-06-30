import type { Category, Distribution } from "./transaction";

export type Source = {
    id: string;
    name: string;
};

export type PaymentMethod = {
    id: string;
    name: string;
    type: "cash" | "digital";
}

export type ClosingNotification = {
    day: number;
    time: string;
}

export type User = {
    name: string;
    email: string;
    sources: Source[];
    distribution: Distribution;
    subcategories: Record<Category, string[]>;
    paymentMethods: PaymentMethod[];
    closingNotification: ClosingNotification;
    onboardingCompleted: boolean;
    lastClosedMonth: string | null;
}