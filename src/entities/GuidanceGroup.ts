import { featureCollection, FeatureCollection } from "@turf/turf"
import { GuidanceGroup, GuidanceGroupAttributes, GuidanceShift } from "../baseEntities"
import { TAGS } from "../baseEntities/constants"
import { registerEntityClass } from "../classRegistry"
import { ISOXMLManager } from "../ISOXMLManager"
import { Entity, XMLElement } from "../types"
import { ExtendedGuidancePattern } from "./GuidancePattern"
import { ExtendedPolygon } from "./Polygon"

export class ExtendedGuidanceGroup extends GuidanceGroup {
    public tag = TAGS.GuidanceGroup

    constructor(attributes: GuidanceGroupAttributes, isoxmlManager: ISOXMLManager) {
        super(attributes, isoxmlManager)
    }

    static fromXml(xml: XMLElement, isoxmlManager: ISOXMLManager, internalId: string): Promise<Entity> {
        return GuidanceGroup.fromXML(xml, isoxmlManager, internalId, ExtendedGuidanceGroup)
    }

    toGeoJSON(guidanceShift?: GuidanceShift): FeatureCollection {
        const boundaryMultiPolygon = ExtendedPolygon.toGeoJSON(this.attributes.BoundaryPolygon ?? [])

        const props = {
            boundaryPolygon: boundaryMultiPolygon,
            guidanceShift
        }

        const patternsFeatureCollections = this.attributes.GuidancePattern?.map(pattern =>
            (pattern as ExtendedGuidancePattern).toGeoJSON(props)
        )

        return featureCollection(patternsFeatureCollections.flatMap(featureCollection => featureCollection.features))
    }

}

registerEntityClass('main', TAGS.GuidanceGroup, ExtendedGuidanceGroup)