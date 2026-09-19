// Fixed application RPC allowlist. No caller-provided SQL identifiers.
export const rpcSpecs = {
  "converge_schema_version": {"params": [], "scalar": false},
  "consume_rate_limit": {
    "params": [
      [
        "p_key",
        "text"
      ],
      [
        "p_window_seconds",
        "integer"
      ],
      [
        "p_limit",
        "integer"
      ]
    ],
    "scalar": false
  },
  "submit_trip_response": {
    "params": [
      [
        "p_trip_id",
        "text"
      ],
      [
        "p_actor_key",
        "text"
      ],
      [
        "p_data",
        "jsonb"
      ]
    ],
    "scalar": false
  },
  "confirm_trip_once": {
    "params": [
      [
        "p_trip_id",
        "text"
      ],
      [
        "p_actor_key",
        "text"
      ],
      [
        "p_date",
        "text"
      ]
    ],
    "scalar": false
  },
  "claim_confirmation_deliveries": {
    "params": [
      [
        "p_trip_id",
        "text"
      ],
      [
        "p_actor_key",
        "text"
      ],
      [
        "p_confirmation_version",
        "integer"
      ]
    ],
    "scalar": false
  },
  "complete_confirmation_delivery": {
    "params": [
      [
        "p_trip_id",
        "text"
      ],
      [
        "p_actor_key",
        "text"
      ],
      [
        "p_confirmation_version",
        "integer"
      ],
      [
        "p_response_public_id",
        "uuid"
      ],
      [
        "p_succeeded",
        "boolean"
      ]
    ],
    "scalar": false
  },
  "reopen_trip": {
    "params": [
      [
        "p_trip_id",
        "text"
      ],
      [
        "p_actor_key",
        "text"
      ]
    ],
    "scalar": false
  },
  "update_trip_planning": {
    "params": [
      [
        "p_trip_id",
        "text"
      ],
      [
        "p_actor_key",
        "text"
      ],
      [
        "p_planning",
        "jsonb"
      ]
    ],
    "scalar": false
  },
  "claim_cached_job": {
    "params": [
      [
        "p_key",
        "text"
      ],
      [
        "p_lease_seconds",
        "integer"
      ],
      [
        "p_force",
        "boolean"
      ]
    ],
    "scalar": false
  },
  "complete_cached_job": {
    "params": [
      [
        "p_key",
        "text"
      ],
      [
        "p_lease",
        "uuid"
      ],
      [
        "p_value",
        "jsonb"
      ],
      [
        "p_ttl_seconds",
        "integer"
      ]
    ],
    "scalar": true
  },
  "release_cached_job": {
    "params": [
      [
        "p_key",
        "text"
      ],
      [
        "p_lease",
        "uuid"
      ]
    ],
    "scalar": true
  },
  "reserve_ai_generation": {
    "params": [
      [
        "p_reserved_micros",
        "integer"
      ],
      [
        "p_daily_limit_micros",
        "integer"
      ]
    ],
    "scalar": false
  },
  "record_ai_generation": {
    "params": [
      [
        "p_reservation_id",
        "uuid"
      ],
      [
        "p_actual_micros",
        "integer"
      ],
      [
        "p_metadata",
        "jsonb"
      ]
    ],
    "scalar": true
  },
  "claim_notification_batch": {
    "params": [
      [
        "p_trip_id",
        "text"
      ],
      [
        "p_limit",
        "integer"
      ]
    ],
    "scalar": false
  },
  "notification_claim_is_current": {
    "params": [
      [
        "p_trip_id",
        "text"
      ],
      [
        "p_confirmation_version",
        "integer"
      ],
      [
        "p_response_public_id",
        "uuid"
      ],
      [
        "p_lease_token",
        "uuid"
      ]
    ],
    "scalar": true
  },
  "finish_notification": {
    "params": [
      [
        "p_trip_id",
        "text"
      ],
      [
        "p_confirmation_version",
        "integer"
      ],
      [
        "p_response_public_id",
        "uuid"
      ],
      [
        "p_lease_token",
        "uuid"
      ],
      [
        "p_succeeded",
        "boolean"
      ]
    ],
    "scalar": true
  },
  "release_notification_claim": {
    "params": [
      [
        "p_trip_id",
        "text"
      ],
      [
        "p_confirmation_version",
        "integer"
      ],
      [
        "p_response_public_id",
        "uuid"
      ],
      [
        "p_lease_token",
        "uuid"
      ]
    ],
    "scalar": true
  },
  "cleanup_converge_storage": {
    "params": [],
    "scalar": true
  }
} as const;
export type RpcName = keyof typeof rpcSpecs;
