
```
$ kubectl get deployments,pods,services
NAME                        READY   UP-TO-DATE   AVAILABLE   AGE
deployment.apps/quote-app   3/3     3            3           3d23h

NAME                            READY   STATUS      RESTARTS   AGE
pod/quote-app-cbd987cb7-chsvc   1/1     Running     0          89m
pod/quote-app-cbd987cb7-xz9h2   1/1     Running     0          88m
pod/quote-app-cbd987cb7-zccm7   1/1     Running     0          89m
pod/service-check               0/1     Completed   0          129m

NAME                TYPE        CLUSTER-IP     EXTERNAL-IP   PORT(S)   AGE
service/quote-app   ClusterIP   10.43.171.71   <none>        80/TCP    134m
```

```
$ kubectl apply -f db-init-configmap.yaml
configmap/quote-db-init created
```

```
$ kubectl apply -f database.yaml
error: error parsing database.yaml: error converting YAML to JSON: yaml: line 2: mapping values are not allowed in this context
```

```
$ kubectl apply -f database.yaml
persistentvolumeclaim/quote-db-data created
deployment.apps/quote-db created
service/quote-db created
```

```
$ kubectl rollout status deployment/quote-db --timeout=180s
deployment "quote-db" successfully rolled out
```

```
$ kubectl get pvc quote-db-data
NAME            STATUS   VOLUME                                     CAPACITY   ACCESS MODES   STORAGECLASS   VOLUMEATTRIBUTESCLASS   AGE
quote-db-data   Bound    pvc-e4536f92-c243-4882-8857-04a80be29659   1Gi        RWO            local-path     <unset>                 73s
```

```
$ kubectl get pods -l app=quote-db
NAME                        READY   STATUS    RESTARTS   AGE
quote-db-796c9c9d49-2bpqc   1/1     Running   0          80s
```

```
$ kubectl logs deployment/quote-db --tail=20


waiting for server to shut down...2026-10-19 08:35:59.135 UTC [53] LOG:  received fast shutdown request
.2026-10-19 08:35:59.138 UTC [53] LOG:  aborting any active transactions
2026-10-19 08:35:59.140 UTC [53] LOG:  background worker "logical replication launcher" (PID 62) exited with exit code 1
2026-10-19 08:35:59.140 UTC [57] LOG:  shutting down
2026-10-19 08:35:59.143 UTC [57] LOG:  checkpoint starting: shutdown immediate
2026-10-19 08:35:59.375 UTC [57] LOG:  checkpoint complete: wrote 953 buffers (5.8%), wrote 3 SLRU buffers; 0 WAL file(s) added, 0 removed, 0 recycled; write=0.035 s, sync=0.183 s, total=0.235 s; sync files=308, longest=0.004 s, average=0.001 s; distance=4378 kB, estimate=4378 kB; lsn=0/1BA8130, redo lsn=0/1BA8130
2026-10-19 08:35:59.391 UTC [53] LOG:  database system is shut down
 done
server stopped

PostgreSQL init process complete; ready for start up.

2026-10-19 08:35:59.464 UTC [1] LOG:  starting PostgreSQL 18.6 (Debian 18.6-1.pgdg13+2) on x86_64-pc-linux-gnu, compiled by gcc (Debian 14.2.0-19) 14.2.0, 64-bit
2026-10-19 08:35:59.464 UTC [1] LOG:  listening on IPv4 address "0.0.0.0", port 5432
2026-10-19 08:35:59.464 UTC [1] LOG:  listening on IPv6 address "::", port 5432
2026-10-19 08:35:59.470 UTC [1] LOG:  listening on Unix socket "/var/run/postgresql/.s.PGSQL.5432"
2026-10-19 08:35:59.479 UTC [77] LOG:  database system was shut down at 2026-10-19 08:35:59 UTC
2026-10-19 08:35:59.485 UTC [1] LOG:  database system is ready to accept connections
```

```
$ kubectl exec deployment/quote-db -- psql -U quote -d quotes -c SELECT count(*) FROM quotes;
 count 
-------
     3
(1 row)

```

```
$ kubectl get secret quote-db-secret
NAME              TYPE     DATA   AGE
quote-db-secret   Opaque   4      8m16s
```

```
$ grep -B1 -A12 -E env:|readinessProbe ../42-kubernetes/deployment.yaml
            - containerPort: 3000
          env:
            - name: DATABASE_URL
              valueFrom:
                secretKeyRef:
                  name: quote-db-secret
                  key: DATABASE_URL
          readinessProbe:
            httpGet:
              path: /health
              port: 3000
            initialDelaySeconds: 3
            periodSeconds: 5
          livenessProbe:
            tcpSocket:
              port: 3000
            initialDelaySeconds: 3
            periodSeconds: 5
```

```
$ kubectl apply -f ../42-kubernetes/deployment.yaml
deployment.apps/quote-app configured
```

```
$ kubectl rollout status deployment/quote-app --timeout=120s
Waiting for deployment "quote-app" rollout to finish: 1 out of 3 new replicas have been updated...
Waiting for deployment "quote-app" rollout to finish: 1 out of 3 new replicas have been updated...
Waiting for deployment "quote-app" rollout to finish: 1 out of 3 new replicas have been updated...
Waiting for deployment "quote-app" rollout to finish: 2 out of 3 new replicas have been updated...
Waiting for deployment "quote-app" rollout to finish: 2 out of 3 new replicas have been updated...
Waiting for deployment "quote-app" rollout to finish: 2 out of 3 new replicas have been updated...
Waiting for deployment "quote-app" rollout to finish: 2 old replicas are pending termination...
Waiting for deployment "quote-app" rollout to finish: 1 old replicas are pending termination...
Waiting for deployment "quote-app" rollout to finish: 1 old replicas are pending termination...
Waiting for deployment "quote-app" rollout to finish: 1 old replicas are pending termination...
deployment "quote-app" successfully rolled out
```

```
$ kubectl get pods -l app=quote-app
NAME                         READY   STATUS    RESTARTS   AGE
quote-app-64c6f6d94f-64x8s   1/1     Running   0          20s
quote-app-64c6f6d94f-fs542   1/1     Running   0          14s
quote-app-64c6f6d94f-pkjn8   1/1     Running   0          26s
```

```
$ sh -c kubectl describe deployment quote-app | grep -A1 DATABASE_URL
      DATABASE_URL:  <set to the key 'DATABASE_URL' in secret 'quote-db-secret'>  Optional: false
    Mounts:          <none>
```

```
$ curl -sS -i --max-time 5 http://127.0.0.1:8080/health
HTTP/1.1 200 OK
content-type: application/json; charset=utf-8
content-length: 21
Date: Mon, 19 Oct 2026 08:46:47 GMT
Connection: keep-alive
Keep-Alive: timeout=72

{"ok":true,"db":"up"}```

```
$ echo res509-1792399615
res509-1792399615
```

```
$ curl -sS -i --max-time 10 --data-urlencode author=RES509 --data-urlencode text=res509-1792399615 http://127.0.0.1:8080/quotes
HTTP/1.1 302 Found
location: /
content-length: 0
Date: Mon, 19 Oct 2026 08:47:03 GMT
Connection: keep-alive
Keep-Alive: timeout=72

```

```
$ grep -F res509-1792399615 /tmp/res509-quotes.html
        <blockquote class="quote-text">res509-1792399615</blockquote>
```

```
$ kubectl get pods -l app=quote-db
NAME                        READY   STATUS    RESTARTS   AGE
quote-db-796c9c9d49-2bpqc   1/1     Running   0          12m
```

```
$ kubectl rollout restart deployment/quote-db
deployment.apps/quote-db restarted
```

```
$ kubectl rollout status deployment/quote-db --timeout=180s
Waiting for deployment "quote-db" rollout to finish: 0 of 1 updated replicas are available...
deployment "quote-db" successfully rolled out
```

```
$ kubectl get pods -l app=quote-db
NAME                       READY   STATUS    RESTARTS   AGE
quote-db-c994b966c-w5ns2   1/1     Running   0          11s
```

```
$ kubectl get pvc quote-db-data
NAME            STATUS   VOLUME                                     CAPACITY   ACCESS MODES   STORAGECLASS   VOLUMEATTRIBUTESCLASS   AGE
quote-db-data   Bound    pvc-e4536f92-c243-4882-8857-04a80be29659   1Gi        RWO            local-path     <unset>                 13m
```

```
$ kubectl get pods -l app=quote-app
NAME                         READY   STATUS    RESTARTS      AGE
quote-app-64c6f6d94f-64x8s   1/1     Running   1 (29s ago)   9m7s
quote-app-64c6f6d94f-fs542   1/1     Running   1 (29s ago)   9m1s
quote-app-64c6f6d94f-pkjn8   1/1     Running   1 (29s ago)   9m13s
```

```
$ grep -F res509-1792399615 /tmp/res509-quotes-after.html
        <blockquote class="quote-text">res509-1792399615</blockquote>
```
