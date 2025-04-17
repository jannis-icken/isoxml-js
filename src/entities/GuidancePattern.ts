import {
    GuidancePattern,
    GuidancePatternAttributes,
    GuidancePatternGuidancePatternExtensionEnum,
    GuidancePatternGuidancePatternPropagationDirectionEnum,
    GuidancePatternGuidancePatternTypeEnum,
    GuidanceShift
} from "../baseEntities"
import { ISOXMLManager } from "../ISOXMLManager"
import { Entity, XMLElement } from "../types"
import {
    LineString as TurfLineString,
    Feature as TurfFeature,
    MultiPolygon as TurfMultiPolygon,
    Position as TurfPosition,
    destination,
    bearing,
    FeatureCollection as TurfFeatureCollection,
    lineOffset,
    cleanCoords,
    lineSplit,
    booleanPointInPolygon,
    feature
} from "@turf/turf"
import { ExtendedLineString } from "./LineString"
import { TAGS } from "../baseEntities/constants"
import { ExtendedPolygon } from "./Polygon"


const TYPE_A_POINT_B_DISTANCE = 1 // distance in meters B-point is created from A-point (for GuidancePattern-type A+)
const EXTENSION_METERS = 5000 // meters by which the LineString will be extended
const PROPAGATION_AMOUNT = 10 // amount of LineStrings that will be propagated if no value is provided

interface GuidancePatternGeoJSONProps {
    boundaryPolygon?: TurfMultiPolygon
    guidanceShift?: GuidanceShift
}

function extendLineString(
    coordinates: TurfPosition[],
    extensionType: GuidancePatternGuidancePatternExtensionEnum,
    lengthMeters: number
): TurfPosition[] {

    if (extensionType === GuidancePatternGuidancePatternExtensionEnum.NoExtensions) {
        return coordinates
    }

    const extendedCoordinates = coordinates

    // let A be the first point of features-array
    const extendFromA: boolean =
        extensionType === GuidancePatternGuidancePatternExtensionEnum.FromBothFirstAndLastPoint ||
        extensionType === GuidancePatternGuidancePatternExtensionEnum.FromFirstPointAOnly

    // let B be the last point of features-array
    const extendFromB: boolean =
        extensionType === GuidancePatternGuidancePatternExtensionEnum.FromBothFirstAndLastPoint ||
        extensionType === GuidancePatternGuidancePatternExtensionEnum.FromLastPointBOnly


    if (extendFromA) {
        const coordsPointA = coordinates[0]
        const coordsPointAfterA = coordinates[1]

        const extensionBearing = bearing(coordsPointA, coordsPointAfterA)
        const pointBeforeA = destination(coordsPointA, -lengthMeters, extensionBearing, { units: 'meters' })

        extendedCoordinates.unshift(pointBeforeA.geometry.coordinates)
    }

    if (extendFromB) {
        const coordsPointBeforeB = coordinates[coordinates.length - 2]
        const coordsPointB = coordinates[coordinates.length - 1]

        const extensionBearing = bearing(coordsPointBeforeB, coordsPointB)
        const pointAfterB = destination(coordsPointB, lengthMeters, extensionBearing, { units: 'meters' })

        extendedCoordinates.push(pointAfterB.geometry.coordinates)
    }

    return extendedCoordinates
}

function propagateLineString(
    initialLineStringFeature: TurfFeature<TurfLineString>,
    direction: GuidancePatternGuidancePatternPropagationDirectionEnum,
    numSwathsLeft: number,
    numSwathsRight: number,
    swathWidth: number
): TurfFeature<TurfLineString>[] {

    const propagatedLineStrings = [initialLineStringFeature]

    const propagateLeft =
        direction == GuidancePatternGuidancePatternPropagationDirectionEnum.BothDirections ||
        direction === GuidancePatternGuidancePatternPropagationDirectionEnum.LeftDirectionOnly

    const propagateRight =
        direction === GuidancePatternGuidancePatternPropagationDirectionEnum.BothDirections ||
        direction === GuidancePatternGuidancePatternPropagationDirectionEnum.RightDirectionOnly

    if (propagateLeft) {
        for (let i = 1; i <= numSwathsLeft; i++) {
            const leftLineString = lineOffset(initialLineStringFeature, -i * swathWidth, { units: 'millimeters' })
            propagatedLineStrings.push(cleanCoords(leftLineString))
        }
    }
    if (propagateRight) {
        for (let i = 1; i <= numSwathsRight; i++) {
            const rightLineString = lineOffset(initialLineStringFeature, i * swathWidth, { units: 'millimeters' })
            propagatedLineStrings.push(cleanCoords(rightLineString))
        }
    }

    return propagatedLineStrings
}

function clipAtBoundaryPolygon(
    lineStringFeature: TurfFeature<TurfLineString>,
    boundaryPolygon?: TurfFeature<TurfMultiPolygon>
): TurfFeature<TurfLineString>[] {
    if (!boundaryPolygon) {
        return [lineStringFeature]
    }

    const clippedLineStrings = lineSplit(lineStringFeature, boundaryPolygon)
    const clippedLineStringsInPolygon = clippedLineStrings.features.filter(feature => {
            const coords = feature.geometry.coordinates
            return coords.every(coord => booleanPointInPolygon(coord, boundaryPolygon))
        })

    return clippedLineStringsInPolygon.flat()
}

export class ExtendedGuidancePattern extends GuidancePattern {
    public tag = TAGS.GuidancePattern

    constructor(attributes: GuidancePatternAttributes, isoxmlManager: ISOXMLManager) {
        super(attributes, isoxmlManager)
    }

    static async fromXml(xml: XMLElement, isoxmlManager: ISOXMLManager, internalId: string): Promise<Entity> {
        const entity = await GuidancePattern.fromXML(xml, isoxmlManager, internalId, ExtendedGuidancePattern)

        if (!entity.attributes.LineString || entity.attributes.LineString.length > 1) {
            isoxmlManager.addWarning(`[${internalId}] GuidancePattern requires one and only one LineString element`)
        }

        return entity
    }

    toGeoJSON(props: GuidancePatternGeoJSONProps): TurfFeatureCollection {
        const lineString = this.attributes.LineString?.[0] as ExtendedLineString
        if (!lineString) {
            throw new Error('Can not generate GeoJSON: GuidancePattern does not contain LineString.')
        }

        const pointCoordinates = lineString.toCoordinatesArray()

        const lineStringFeature: TurfFeature<TurfLineString> = {
            type: 'Feature',
            geometry: {
                type: 'LineString',
                coordinates: []
            },
            properties: {}
        }

        const patternType = this.attributes.GuidancePatternType
        if (patternType === GuidancePatternGuidancePatternTypeEnum.Curve ||
            patternType === GuidancePatternGuidancePatternTypeEnum.Pivot ||
            patternType === GuidancePatternGuidancePatternTypeEnum.Spiral) {
            throw new Error(`GeoJSON for GuidancePatternType ${patternType} is not supported`)
        }

        if (patternType === GuidancePatternGuidancePatternTypeEnum.A) {

            const heading = this.attributes.GuidancePatternHeading
            if (heading === undefined) {
                throw new Error('GuidancePattern of type A+ without GuidancePatternHeading is invalid')
            }

            const coordsPointA = pointCoordinates[0]
            if (!coordsPointA) {
                throw new Error('GuidancePattern LineString does not contain points')
            }

            const pointB = destination(coordsPointA, TYPE_A_POINT_B_DISTANCE, heading, { units: 'meters' })
            const coordsPointB = pointB.geometry.coordinates

            lineStringFeature.geometry.coordinates = [coordsPointA, coordsPointB]

        } else if (patternType === GuidancePatternGuidancePatternTypeEnum.AB) {

            if (pointCoordinates.length < 2) {
                throw new Error('GuidancePattern of type A requires two points')
            }

            const coordsPointA = pointCoordinates[0]
            const coordsPointB = pointCoordinates[1]

            lineStringFeature.geometry.coordinates = [coordsPointA, coordsPointB]

        }

        // apply GuidancePatternExtension
        const extensionType =
            this.attributes.GuidancePatternExtension ??
            GuidancePatternGuidancePatternExtensionEnum.FromBothFirstAndLastPoint

        lineStringFeature.geometry.coordinates = {
            ...extendLineString(lineStringFeature.geometry.coordinates, extensionType, EXTENSION_METERS)
        }

        // apply propagation with swath width
        const propagationDirection =
            this.attributes.GuidancePatternPropagationDirection ??
            GuidancePatternGuidancePatternPropagationDirectionEnum.BothDirections

        const swathWidth = lineString.attributes.LineStringWidth
        // in case swathWidth is not defined this evaluates to 0 and we do not propagate at all

        const propagatedLineStrings = propagateLineString(
            lineStringFeature,
            propagationDirection,
            this.attributes.NumberOfSwathsLeft ?? PROPAGATION_AMOUNT,
            this.attributes.NumberOfSwathsRight ?? PROPAGATION_AMOUNT,
            swathWidth
        )

        // apply local boundary polygon from GuidancePattern and boundary polygon from props
        const clippedLineStrings: TurfFeature<TurfLineString>[] = []
        const boundaryMultiPolygon = ExtendedPolygon.toGeoJSON(this.attributes.BoundaryPolygon ?? [])

        for (const lineString of propagatedLineStrings) {

            const clippedLocalBoundaryPolygon = clipAtBoundaryPolygon(lineString, feature(boundaryMultiPolygon))

            for (const lineString of clippedLocalBoundaryPolygon) {
                const clippedPropsBoundaryPolygon = clipAtBoundaryPolygon(lineString, feature(props.boundaryPolygon))
                clippedLineStrings.push(...clippedPropsBoundaryPolygon)
            }

        }

        const properties = {
            color: lineString.attributes.LineStringColour
        }

        return {
            type: 'FeatureCollection',
            features:
                clippedLineStrings
                    .filter(feature => feature.geometry?.coordinates?.length !== 0)
                    ?.map(feature => ({...feature, properties: properties}))
        }
    }
}