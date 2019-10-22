declare class Serializer {
    serialize(object: any): string;
    deserialize(json: any): any;
    ndserialize(array: any): string;
    qserialize(object: any): string;
}
export default Serializer;
