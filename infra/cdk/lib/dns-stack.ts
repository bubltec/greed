import * as cdk from 'aws-cdk-lib';
import type { Construct } from 'constructs';
import * as route53 from 'aws-cdk-lib/aws-route53';

export interface DnsStackProps extends cdk.StackProps {
  parentDomain: string;
  domainName: string;
}

/**
 * Deployed once from a laptop (`pnpm infra:dns`), same as grtzplz's DNS stack.
 *
 * `bubbletech.io` already exists (political-sloth's SlothDns owns it) and is only
 * looked up here, never created: Route53 would happily make a duplicate zone and
 * nothing would say the delegation points at the wrong one. This stack creates
 * `greed.bubbletech.io` and NS-delegates it from the parent, so there is nothing
 * to do at a registrar. Both dev (dev.greed…) and prod (greed…) live in this zone.
 */
export class DnsStack extends cdk.Stack {
  readonly zone: route53.PublicHostedZone;

  constructor(scope: Construct, id: string, props: DnsStackProps) {
    super(scope, id, props);

    const parent = route53.HostedZone.fromLookup(this, 'ParentZone', {
      domainName: props.parentDomain,
    });

    this.zone = new route53.PublicHostedZone(this, 'Zone', { zoneName: props.domainName });
    this.zone.applyRemovalPolicy(cdk.RemovalPolicy.RETAIN);

    new route53.NsRecord(this, 'Delegation', {
      zone: parent,
      recordName: props.domainName.slice(0, -1 - props.parentDomain.length),
      values: this.zone.hostedZoneNameServers ?? [],
    });

    new cdk.CfnOutput(this, 'HostedZoneId', {
      value: this.zone.hostedZoneId,
      description: 'Set as GREED_HOSTED_ZONE_ID (locally and as a GitHub Actions variable)',
    });
  }
}
