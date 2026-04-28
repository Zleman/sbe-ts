import { MessageFlyweight } from './flyweight.js';

export const CompositeFlyweight: typeof MessageFlyweight = MessageFlyweight;
export type CompositeFlyweight = InstanceType<typeof MessageFlyweight>;
