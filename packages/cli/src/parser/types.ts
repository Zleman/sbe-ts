export type ByteOrder = 'littleEndian' | 'bigEndian';

export interface SbeField {
  name: string;
  id: number;
  type: string;
  offset: number;
}

export interface SbeVarData {
  name: string;
  id: number;
  type: string;
  lengthPrimitiveType: string;
  lengthByteSize: number;
}

export interface SbeGroup {
  name: string;
  id: number;
  blockLength: number;
  dimensionType: string;
  numInGroupOffset: number;    // byte offset of numInGroup within the dimension header (default 2)
  numInGroupPrimitive: string; // primitive type of numInGroup field (default 'uint16')
  headerSize: number;          // total byte size of the dimension header (default 4)
  fields: SbeField[];
  groups: SbeGroup[];
  varData: SbeVarData[];
}

export interface SbeMessage {
  name: string;
  id: number;
  blockLength: number;
  fields: SbeField[];
  groups: SbeGroup[];
  varData: SbeVarData[];
}

export interface SbeCompositeField {
  name: string;
  primitiveType: string;  // may be a primitive, enum name, set name, or composite name (for <ref>)
  length?: number;        // 1 for scalars; >1 for array types (e.g. char[6])
  byteSize?: number;      // pre-computed wire size; absence means derive from primitiveType at use-site
  isConstant?: boolean;   // presence="constant" → 0 wire bytes, no accessor
}

export interface SbeComposite {
  name: string;
  fields: SbeCompositeField[];
}

export interface SbeEnum {
  name: string;
  encodingType: string;
  values: Array<{ name: string; value: number }>;
}

export interface SbeSet {
  name: string;
  encodingType: string;
  choices: Array<{ name: string; bitIndex: number }>;
}

export interface SbeSchema {
  package: string;
  id: number;
  version: number;
  byteOrder: ByteOrder;
  messages: SbeMessage[];
  composites: SbeComposite[];
  enums: SbeEnum[];
  sets: SbeSet[];
}
