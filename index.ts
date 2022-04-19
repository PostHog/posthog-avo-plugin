import { randomUUID } from 'crypto'
import { Plugin } from '@posthog/plugin-scaffold'
import fetch from 'node-fetch'

interface AvoInspectorMeta {
    global: {
        defaultHeaders: Record<string, string>
    }
    config: {
        appName: string
        avoApiKey: string
        environment: string
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
}

export const exportEvents: AvoInspectorPlugin['exportEvents'] = async (events, { config, global }) => {
    if (events.length === 0) {
        return
    }

    const sessionId = randomUUID()
    const now = new Date().toISOString()
    const avoEvents = []

    const baseEventPayload = {
        apiKey: config.avoApiKey,
        env: config.environment,
        appName: config.appName,
        sessionId: sessionId,
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

    for (const event of events) {
        if (!event.event.startsWith("$")) {
            avoEvents.push({
                ...baseEventPayload,
                eventName: event.event,
                messageId: event.uuid,
                eventProperties: event.properties ? convertPosthogPropsToAvoProps(event.properties) : [],
            })
        }
    }

    try {
        // start a tracking session
        const sessionStartRes = await fetch('https://api.avo.app/inspector/posthog/v1/track', {
            method: 'POST',
            headers: global.defaultHeaders,
            body: JSON.stringify([
                {
                    apiKey: config.avoApiKey,
                    env: config.environment,
                    appName: config.appName,
                    createdAt: now,
                    sessionId: sessionId,
                    appVersion: '1.0.0',
                    libVersion: '1.0.1',
                    libPlatform: 'node',
                    messageId: randomUUID(),
                    trackingId: '',
                    samplingRate: 1,
                    type: 'sessionStarted',
                },
            ]),
        })

        if (sessionStartRes.status !== 200) {
            throw new Error(`sessionStarted request failed with status code ${sessionStartRes.status}`)
        }

        // track events
        const trackEventsRes = await fetch('https://api.avo.app/inspector/posthog/v1/track', {
            method: 'POST',
            headers: global.defaultHeaders,
            body: JSON.stringify(avoEvents),
        })

        // https://github.com/node-fetch/node-fetch/issues/1262
        const trackEventsResJson = (await trackEventsRes.json()) as Record<string, any> | null

        if (
            trackEventsRes.status !== 200 ||
            !trackEventsResJson ||
            ('ok' in trackEventsResJson && !trackEventsResJson.ok)
        ) {
            throw new Error('track events request failed')
        }

        console.log(`Succesfully sent ${events.length} events to Avo`)
    } catch (err) {
        const errorMessage = err instanceof Error ? err.message : String(err)
        console.error('Unable to send data to Avo with error:', errorMessage)
    }
}

const convertPosthogPropsToAvoProps = (properties: Record<string, any>): Record<string, string>[] => {
    const avoProps = []
    for (const [propertyName, propertyValue] of Object.entries(properties)) {
        if (!propertyName.startsWith("$")) {
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
