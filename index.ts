import { Plugin } from '@posthog/plugin-scaffold'

interface AvoInspectorMeta {
    global: {
        defaultHeaders: Record<string, string>,
        excludeEvents: Set<String>,
        includeEvents: Set<String>,
        excludeProperties: Set<String>,
        includeProperties: Set<String>,
    }
    config: {
        appName: string
        avoApiKey: string
        environment: string
        excludeEvents: string
        includeEvents: string
        excludeProperties: string
        includeProperties: string
    }
}
type AvoInspectorPlugin = Plugin<AvoInspectorMeta>

export const setupPlugin: AvoInspectorPlugin['setupPlugin'] = async ({ config, global }) => {
    global.defaultHeaders = {
        env: config.environment,
        'api-key': config.avoApiKey,
        'content-type': 'application/json',
        accept: 'application/json',
    }

    global.excludeEvents = new Set(
        config.excludeEvents ? config.excludeEvents.split(',').map((event) => event.trim()) : null
    )
    global.includeEvents = new Set(
        config.includeEvents ? config.includeEvents.split(',').map((event) => event.trim()) : null
    )
    global.excludeProperties = new Set(
        config.excludeProperties ? config.excludeProperties.split(',').map((event) => event.trim()) : null
    )
    global.includeProperties = new Set(
        config.includeProperties ? config.includeProperties.split(',').map((event) => event.trim()) : null
    )
}

export const composeWebhook: AvoInspectorPlugin['onEvent'] = (event, { config, global }) => {
    const isIncluded = global.includeEvents.length > 0 ? global.includeEvents.has(event.event) : true
    const isExcluded = global.excludeEvents.has(event.event)

    if (event.event.startsWith("$") || (isExcluded || !isIncluded)) {
        return
    }

    const now = new Date().toISOString()

    const baseEventPayload = {
        apiKey: config.avoApiKey,
        env: config.environment,
        appName: config.appName,
        createdAt: now,
        avoFunction: false,
        eventId: null,
        eventHash: null,
        appVersion: '1.0.0',
        libVersion: '1.0.0',
        libPlatform: 'node',
        messageId: '5875bc8b-a8e6-4f20-a499-8af557467a02',
        trackingId: '',
        samplingRate: 1,
        type: 'event',
        eventName: 'event_name',
        eventProperties: [],
    }

    const avoEvent = {
        ...baseEventPayload,
        eventName: event.event,
        messageId: event.uuid,
        eventProperties: event.properties ? convertPosthogPropsToAvoProps(event.properties, global.excludeProperties, global.includeProperties) : [],
    }

    return {
        url: 'https://api.avo.app/inspector/posthog/v1/track',
        headers: global.defaultHeaders,
        body: JSON.stringify([avoEvent]),
        method: 'POST',
    }
}

const convertPosthogPropsToAvoProps = (properties: Record<string, any>, excludeProperties: Set<String>, includeProperties: Set<String>): Record<string, string>[] => {
    const avoProps = []

    for (const [propertyName, propertyValue] of Object.entries(properties)) {
        const isIncluded = includeProperties.size > 0 ? includeProperties.has(propertyName) : true
        const isExcluded = excludeProperties.has(propertyName)

        if (!propertyName.startsWith("$") && isIncluded && !isExcluded) {
            avoProps.push({ propertyName, propertyType: getPropValueType(propertyValue) })
        };
    }
    return avoProps
}

// Compatible with the Avo Rudderstack integration
const getPropValueType = (propValue: any): string => {
    let propType = typeof propValue
    if (propValue == null) {
        return 'null'
    } else if (propType === 'string') {
        return 'string'
    } else if (propType === 'number' || propType === 'bigint') {
        if ((propValue + '').indexOf('.') >= 0) {
            return 'float'
        } else {
            return 'int'
        }
    } else if (propType === 'boolean') {
        return 'boolean'
    } else if (propType === 'object') {
        if (Array.isArray(propValue)) {
            return 'list'
        } else {
            return 'object'
        }
    } else {
        return propType
    }
}
